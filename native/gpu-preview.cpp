#include <chrono>
#include <glib.h>
#include <gst/app/gstappsink.h>
#include <gst/d3d11/gstd3d11.h>
#include <gst/gst.h>
#include <iostream>
#include <json-glib/json-glib.h>
#include <memory>
#include <stdexcept>
#include <string>
#include <wrl/client.h>
using Microsoft::WRL::ComPtr;
template <class T> auto own(T *p) {
  return std::unique_ptr<T, void (*)(T *)>(p, [](T *v) {
    if (v)
      g_object_unref(v);
  });
}
void fail_event(const std::string &message) {
  auto b = own(json_builder_new());
  json_builder_begin_object(b.get());
  json_builder_set_member_name(b.get(), "event");
  json_builder_add_string_value(b.get(), "error");
  json_builder_set_member_name(b.get(), "message");
  json_builder_add_string_value(b.get(), message.c_str());
  json_builder_end_object(b.get());
  auto g = own(json_generator_new());
  auto *n = json_builder_get_root(b.get());
  json_generator_set_root(g.get(), n);
  gchar *text = json_generator_to_data(g.get(), nullptr);
  std::cout << text << std::endl;
  g_free(text);
  json_node_free(n);
}

gboolean allocate_shared(GstAppSink *, GstQuery *query, gpointer data) {
  GstCaps *caps = nullptr;
  gboolean needed = FALSE;
  gst_query_parse_allocation(query, &caps, &needed);
  GstVideoInfo info;
  if (!caps || !gst_video_info_from_caps(&info, caps))
    return FALSE;
  auto *device = GST_D3D11_DEVICE(data);
  auto pool = own(gst_d3d11_buffer_pool_new(device));
  auto *config = gst_buffer_pool_get_config(pool.get());
  gst_buffer_pool_config_set_params(config, caps, static_cast<guint>(info.size), 2, 4);
  gst_buffer_pool_config_add_option(config, GST_BUFFER_POOL_OPTION_VIDEO_META);
  auto *params = gst_d3d11_allocation_params_new(
      device, &info, GST_D3D11_ALLOCATION_FLAG_DEFAULT,
      D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE,
      D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED);
  gst_buffer_pool_config_set_d3d11_allocation_params(config, params);
  gst_d3d11_allocation_params_free(params);
  if (!gst_buffer_pool_set_config(pool.get(), config))
    return FALSE;
  gst_query_add_allocation_pool(query, pool.get(), static_cast<guint>(info.size), 2, 4);
  gst_query_add_allocation_meta(query, GST_VIDEO_META_API_TYPE, nullptr);
  return TRUE;
}
void link_video(GstElement *, GstPad *pad, gpointer target) {
  GstCaps *caps = gst_pad_get_current_caps(pad);
  if (!caps)
    return;
  bool video = gst_structure_has_name(gst_caps_get_structure(caps, 0), "video/x-raw") &&
               gst_caps_features_contains(gst_caps_get_features(caps, 0),
                                          GST_CAPS_FEATURE_MEMORY_D3D11_MEMORY);
  gst_caps_unref(caps);
  if (video) {
    GstPad *sink = gst_element_get_static_pad(GST_ELEMENT(target), "sink");
    if (!gst_pad_is_linked(sink))
      gst_pad_link(pad, sink);
    gst_object_unref(sink);
  }
}
gint select_gpu_decoder(GstElement *, GstPad *, GstCaps *, GstElementFactory *factory, gpointer) {
  const char *kind = gst_element_factory_get_metadata(factory, GST_ELEMENT_METADATA_KLASS);
  const char *name = gst_plugin_feature_get_name(GST_PLUGIN_FEATURE(factory));
  if (kind && g_strrstr(kind, "Decoder") && g_strrstr(kind, "Video") &&
      !g_str_has_prefix(name, "d3d11"))
    return 2; // SKIP; no software/CUDA/D3D12-to-CPU detour.
  return 0;   // TRY
}
struct Pipeline {
  GstElement *value = nullptr;
  ~Pipeline() {
    if (value) {
      gst_element_set_state(value, GST_STATE_NULL);
      gst_object_unref(value);
    }
  }
};
struct Handle {
  HANDLE value = nullptr;
  ~Handle() {
    if (value)
      CloseHandle(value);
  }
};
void finish_gpu(GstD3D11Memory *memory) {
  auto *device = memory->device;
  auto *d3d = gst_d3d11_device_get_device_handle(device);
  auto *context = gst_d3d11_device_get_device_context_handle(device);
  D3D11_QUERY_DESC desc = {D3D11_QUERY_EVENT, 0};
  ComPtr<ID3D11Query> query;
  if (FAILED(d3d->CreateQuery(&desc, &query)))
    throw std::runtime_error("Cannot create GPU completion query");
  gst_d3d11_device_lock(device);
  context->End(query.Get());
  context->Flush();
  gst_d3d11_device_unlock(device);
  const auto start = std::chrono::steady_clock::now();
  for (;;) {
    gst_d3d11_device_lock(device);
    HRESULT result = context->GetData(query.Get(), nullptr, 0, 0);
    gst_d3d11_device_unlock(device);
    if (result == S_OK)
      break;
    if (FAILED(result) || std::chrono::steady_clock::now() - start > std::chrono::seconds(5))
      throw std::runtime_error("GPU synchronization failed");
    Sleep(1);
  }
}
int preview(const char *uri, DWORD consumer_pid) {
  Handle consumer{OpenProcess(PROCESS_DUP_HANDLE | SYNCHRONIZE, FALSE, consumer_pid)};
  if (!consumer.value)
    throw std::runtime_error("Cannot access texture consumer process");
  auto device = own(gst_d3d11_device_new(0, D3D11_CREATE_DEVICE_BGRA_SUPPORT));
  if (!device)
    throw std::runtime_error("No D3D11 device available");
  Pipeline pipeline{gst_pipeline_new("gpu-preview")};
  const bool pattern = std::string(uri) == "--pattern";
  GstElement *source =
      gst_element_factory_make(pattern ? "d3d11testsrc" : "uridecodebin", "source");
  GstElement *convert = gst_element_factory_make("d3d11convert", "convert");
  GstElement *filter = gst_element_factory_make("capsfilter", "format");
  GstElement *sink = gst_element_factory_make("appsink", "frames");
  if (!source || !convert || !filter || !sink)
    throw std::runtime_error("Required D3D11 elements are not available");
  GstCaps *caps = gst_caps_from_string("video/x-raw(memory:D3D11Memory),format=BGRA");
  g_object_set(filter, "caps", caps, nullptr);
  gst_caps_unref(caps);
  g_object_set(sink, "emit-signals", TRUE, "sync", TRUE, "max-buffers", 2u, "drop", FALSE, nullptr);
  g_signal_connect(sink, "propose-allocation", G_CALLBACK(allocate_shared), device.get());
  gst_bin_add_many(GST_BIN(pipeline.value), source, convert, filter, sink, nullptr);
  if (!gst_element_link_many(convert, filter, sink, nullptr))
    throw std::runtime_error("Cannot link GPU output pipeline");
  GstContext *context = gst_d3d11_context_new(device.get());
  gst_element_set_context(pipeline.value, context);
  gst_context_unref(context);
  if (pattern) {
    g_object_set(source, "num-buffers", 8, nullptr);
    if (!gst_element_link(source, convert))
      throw std::runtime_error("Cannot link GPU test source");
  } else {
    caps = gst_caps_from_string("video/x-raw(memory:D3D11Memory)");
    g_object_set(source, "uri", uri, "caps", caps, nullptr);
    gst_caps_unref(caps);
    g_signal_connect(source, "autoplug-select", G_CALLBACK(select_gpu_decoder), nullptr);
    g_signal_connect(source, "pad-added", G_CALLBACK(link_video), convert);
  }
  auto bus = own(gst_element_get_bus(pipeline.value));
  if (gst_element_set_state(pipeline.value, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE)
    throw std::runtime_error("Cannot start GPU decoding");
  unsigned count = 0;
  while (WaitForSingleObject(consumer.value, 0) != WAIT_OBJECT_0) {
    GstSample *sample = gst_app_sink_try_pull_sample(GST_APP_SINK(sink), 10 * GST_SECOND);
    if (!sample) {
      GstMessage *message = gst_bus_pop_filtered(bus.get(), GST_MESSAGE_ERROR);
      if (message) {
        GError *error = nullptr;
        gchar *debug = nullptr;
        gst_message_parse_error(message, &error, &debug);
        std::string reason = error ? error->message : "GPU pipeline error";
        if (debug)
          std::cerr << debug << std::endl;
        g_clear_error(&error);
        g_free(debug);
        gst_message_unref(message);
        throw std::runtime_error(reason);
      }
      if (gst_app_sink_is_eos(GST_APP_SINK(sink)))
        break;
      throw std::runtime_error("No GPU frame received; CPU fallback is disabled");
    }
    std::unique_ptr<GstSample, decltype(&gst_sample_unref)> held(sample, gst_sample_unref);
    GstBuffer *buffer = gst_sample_get_buffer(sample);
    if (gst_buffer_n_memory(buffer) != 1 || !gst_is_d3d11_memory(gst_buffer_peek_memory(buffer, 0)))
      throw std::runtime_error("Pipeline returned CPU memory; refusing to label it zero-copy");
    auto *memory = GST_D3D11_MEMORY_CAST(gst_buffer_peek_memory(buffer, 0));
    D3D11_TEXTURE2D_DESC desc;
    gst_d3d11_memory_get_texture_desc(memory, &desc);
    HANDLE local = nullptr;
    if (!gst_d3d11_memory_get_nt_handle(memory, &local))
      throw std::runtime_error(
          "Upstream did not accept the shared texture pool; no copy fallback is used");
    finish_gpu(memory);
    HANDLE remote = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), local, consumer.value, &remote, 0, FALSE,
                         DUPLICATE_SAME_ACCESS))
      throw std::runtime_error("Cannot duplicate shared texture handle into Electron");
    const auto stamp = GST_BUFFER_PTS_IS_VALID(buffer) ? GST_BUFFER_PTS(buffer) / GST_USECOND : 0;
    std::cout << "{\"event\":\"frame\",\"frameId\":" << ++count << ",\"handle\":\""
              << reinterpret_cast<uintptr_t>(remote) << "\",\"width\":" << desc.Width
              << ",\"height\":" << desc.Height << ",\"timestamp\":" << stamp
              << ",\"pixelFormat\":\"bgra\",\"memory\":\"D3D11Memory\",\"cpuReadbacks\":0,"
                 "\"bridgeGpuCopies\":0,\"testPattern\":"
              << (pattern ? "true" : "false") << "}" << std::endl;
    // Keep the sample alive until Chromium has released all GPU references.
    std::string ack;
    bool received = static_cast<bool>(std::getline(std::cin, ack));
    HANDLE duplicate = nullptr;
    if (DuplicateHandle(consumer.value, remote, GetCurrentProcess(), &duplicate, 0, FALSE,
                        DUPLICATE_CLOSE_SOURCE | DUPLICATE_SAME_ACCESS))
      CloseHandle(duplicate);
    if (!received || ack == "stop")
      break;
  }
  std::cout << "{\"event\":\"complete\",\"frames\":" << count << "}" << std::endl;
  return 0;
}
int main() {
  gchar **args = g_win32_get_command_line();
  int argc = g_strv_length(args);
  gst_init(nullptr, nullptr);
  int result = 0;
  try {
    if (argc != 3)
      throw std::runtime_error("Usage: workstation-gpu-preview URI|--pattern CONSUMER_PID");
    result = preview(args[1], static_cast<DWORD>(std::stoul(args[2])));
  } catch (const std::exception &error) {
    fail_event(error.what());
    result = 1;
  }
  gst_deinit();
  g_strfreev(args);
  return result;
}
