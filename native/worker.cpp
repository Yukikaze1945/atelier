#include <algorithm>
#include <ges/ges.h>
#include <gst/pbutils/pbutils.h>
#include <iostream>
#include <json-glib/json-glib.h>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <glib.h>
#include <windows.h>
#endif

template <class T> auto owned(T *value) {
  return std::unique_ptr<T, void (*)(T *)>(value, [](T *p) {
    if (p)
      g_object_unref(p);
  });
}
std::string str(JsonObject *object, const char *key) {
  if (!json_object_has_member(object, key))
    throw std::runtime_error(std::string("Missing field: ") + key);
  const char *value = json_object_get_string_member(object, key);
  if (!value)
    throw std::runtime_error(std::string("Invalid field: ") + key);
  return value;
}
void output(JsonBuilder *builder) {
  auto generator = owned(json_generator_new());
  JsonNode *node = json_builder_get_root(builder);
  json_generator_set_root(generator.get(), node);
  gchar *text = json_generator_to_data(generator.get(), nullptr);
  std::cout << text << std::endl;
  g_free(text);
  json_node_free(node);
}
void event(const char *kind, const std::string &message = "", double progress = -1) {
  auto b = owned(json_builder_new());
  json_builder_begin_object(b.get());
  json_builder_set_member_name(b.get(), "event");
  json_builder_add_string_value(b.get(), kind);
  if (!message.empty()) {
    json_builder_set_member_name(b.get(), "message");
    json_builder_add_string_value(b.get(), message.c_str());
  }
  if (progress >= 0) {
    json_builder_set_member_name(b.get(), "progress");
    json_builder_add_double_value(b.get(), progress);
  }
  json_builder_end_object(b.get());
  output(b.get());
}
bool factory(const char *name) {
  auto f = owned(gst_element_factory_find(name));
  return f != nullptr;
}
void probe() {
  auto b = owned(json_builder_new());
  json_builder_begin_object(b.get());
  json_builder_set_member_name(b.get(), "available");
  json_builder_add_boolean_value(b.get(), TRUE);
  json_builder_set_member_name(b.get(), "gesAvailable");
  json_builder_add_boolean_value(b.get(), TRUE);
  json_builder_set_member_name(b.get(), "renderAvailable");
  json_builder_add_boolean_value(b.get(), factory("encodebin") && factory("compositor"));
  json_builder_set_member_name(b.get(), "version");
  gchar *version = gst_version_string();
  json_builder_add_string_value(b.get(), version);
  g_free(version);
  json_builder_set_member_name(b.get(), "profiles");
  json_builder_begin_array(b.get());
  if (factory("x264enc") && factory("mp4mux") && (factory("avenc_aac") || factory("voaacenc")))
    json_builder_add_string_value(b.get(), "mp4-h264");
  if (factory("vp8enc") && factory("webmmux") && factory("vorbisenc"))
    json_builder_add_string_value(b.get(), "webm-vp8");
  json_builder_end_array(b.get());
  json_builder_set_member_name(b.get(), "elements");
  json_builder_begin_object(b.get());
  for (const auto *name :
       {"x264enc", "nvh264enc", "d3d11h264dec", "d3d12h264dec", "d3d11convert", "d3d12convert",
        "d3d11ipcsrc", "d3d11ipcsink", "d3d12ipcsrc", "d3d12ipcsink"}) {
    json_builder_set_member_name(b.get(), name);
    json_builder_add_boolean_value(b.get(), factory(name));
  }
  json_builder_end_object(b.get());
  json_builder_set_member_name(b.get(), "gpuZeroCopy");
  json_builder_begin_object(b.get());
  json_builder_set_member_name(b.get(), "validated");
  json_builder_add_boolean_value(b.get(), FALSE);
  json_builder_set_member_name(b.get(), "reason");
  json_builder_add_string_value(
      b.get(), "Decoder/GES compositor/shared-texture negotiation must be validated end-to-end");
  json_builder_end_object(b.get());
  json_builder_end_object(b.get());
  output(b.get());
}
void inspect(const char *uri) {
  GError *error = nullptr;
  auto discoverer = owned(gst_discoverer_new(15 * GST_SECOND, &error));
  if (!discoverer)
    throw std::runtime_error(error ? error->message : "Cannot create discoverer");
  auto info = owned(gst_discoverer_discover_uri(discoverer.get(), uri, &error));
  if (!info || gst_discoverer_info_get_result(info.get()) != GST_DISCOVERER_OK) {
    std::string message = error ? error->message : "Media discovery failed";
    g_clear_error(&error);
    throw std::runtime_error(message);
  }
  auto b = owned(json_builder_new());
  json_builder_begin_object(b.get());
  json_builder_set_member_name(b.get(), "uri");
  json_builder_add_string_value(b.get(), uri);
  const auto duration = gst_discoverer_info_get_duration(info.get());
  json_builder_set_member_name(b.get(), "duration");
  json_builder_add_double_value(
      b.get(), GST_CLOCK_TIME_IS_VALID(duration) ? double(duration) / GST_SECOND : 0);
  json_builder_set_member_name(b.get(), "streams");
  json_builder_begin_array(b.get());
  GList *streams = gst_discoverer_info_get_stream_list(info.get());
  for (GList *item = streams; item; item = item->next) {
    auto *stream = GST_DISCOVERER_STREAM_INFO(item->data);
    json_builder_begin_object(b.get());
    json_builder_set_member_name(b.get(), "type");
    json_builder_add_string_value(b.get(), GST_IS_DISCOVERER_VIDEO_INFO(stream)   ? "video"
                                           : GST_IS_DISCOVERER_AUDIO_INFO(stream) ? "audio"
                                                                                  : "other");
    if (GST_IS_DISCOVERER_VIDEO_INFO(stream)) {
      auto *video = GST_DISCOVERER_VIDEO_INFO(stream);
      json_builder_set_member_name(b.get(), "width");
      json_builder_add_int_value(b.get(), gst_discoverer_video_info_get_width(video));
      json_builder_set_member_name(b.get(), "height");
      json_builder_add_int_value(b.get(), gst_discoverer_video_info_get_height(video));
      json_builder_set_member_name(b.get(), "frameRate");
      json_builder_begin_object(b.get());
      json_builder_set_member_name(b.get(), "numerator");
      json_builder_add_int_value(b.get(), gst_discoverer_video_info_get_framerate_num(video));
      json_builder_set_member_name(b.get(), "denominator");
      json_builder_add_int_value(b.get(), gst_discoverer_video_info_get_framerate_denom(video));
      json_builder_end_object(b.get());
    }
    if (GST_IS_DISCOVERER_AUDIO_INFO(stream)) {
      json_builder_set_member_name(b.get(), "channels");
      json_builder_add_int_value(
          b.get(), gst_discoverer_audio_info_get_channels(GST_DISCOVERER_AUDIO_INFO(stream)));
      json_builder_set_member_name(b.get(), "sampleRate");
      json_builder_add_int_value(
          b.get(), gst_discoverer_audio_info_get_sample_rate(GST_DISCOVERER_AUDIO_INFO(stream)));
    }
    json_builder_end_object(b.get());
  }
  gst_discoverer_stream_info_list_free(streams);
  json_builder_end_array(b.get());
  json_builder_end_object(b.get());
  output(b.get());
}
void pipeline_audit(GstElement *pipeline) {
  auto builder = owned(json_builder_new());
  json_builder_begin_object(builder.get());
  json_builder_set_member_name(builder.get(), "event");
  json_builder_add_string_value(builder.get(), "pipeline-audit");
  json_builder_set_member_name(builder.get(), "elements");
  json_builder_begin_array(builder.get());
  bool system_compositor = false;
  bool complete = true;
  GstIterator *elements = gst_bin_iterate_recurse(GST_BIN(pipeline));
  GValue value = G_VALUE_INIT;
  GstIteratorResult result;
  while ((result = gst_iterator_next(elements, &value)) == GST_ITERATOR_OK) {
    auto *element = GST_ELEMENT(g_value_get_object(&value));
    GstElementFactory *factory = gst_element_get_factory(element);
    const char *klass =
        factory ? gst_element_factory_get_metadata(factory, GST_ELEMENT_METADATA_KLASS) : nullptr;
    if (klass && g_strrstr(klass, "Video")) {
      const bool compositor = g_strrstr(klass, "Compositor") != nullptr;
      json_builder_begin_object(builder.get());
      json_builder_set_member_name(builder.get(), "factory");
      json_builder_add_string_value(builder.get(),
                                    gst_plugin_feature_get_name(GST_PLUGIN_FEATURE(factory)));
      json_builder_set_member_name(builder.get(), "name");
      json_builder_add_string_value(builder.get(), GST_ELEMENT_NAME(element));
      json_builder_set_member_name(builder.get(), "compositor");
      json_builder_add_boolean_value(builder.get(), compositor);
      json_builder_set_member_name(builder.get(), "pads");
      json_builder_begin_array(builder.get());
      GstIterator *pads = gst_element_iterate_pads(element);
      GValue pad_value = G_VALUE_INIT;
      while (gst_iterator_next(pads, &pad_value) == GST_ITERATOR_OK) {
        GstPad *pad = GST_PAD(g_value_get_object(&pad_value));
        GstCaps *caps = gst_pad_get_current_caps(pad);
        if (caps && !gst_caps_is_empty(caps) && !gst_caps_is_any(caps)) {
          const bool raw = gst_structure_has_name(gst_caps_get_structure(caps, 0), "video/x-raw");
          GstCapsFeatures *features = gst_caps_get_features(caps, 0);
          const bool system =
              raw && !gst_caps_features_is_any(features) &&
              (gst_caps_features_get_size(features) == 0 ||
               gst_caps_features_contains(features, GST_CAPS_FEATURE_MEMORY_SYSTEM_MEMORY));
          system_compositor = system_compositor || (compositor && system);
          json_builder_begin_object(builder.get());
          json_builder_set_member_name(builder.get(), "name");
          json_builder_add_string_value(builder.get(), GST_PAD_NAME(pad));
          json_builder_set_member_name(builder.get(), "systemMemoryVideo");
          json_builder_add_boolean_value(builder.get(), system);
          json_builder_set_member_name(builder.get(), "caps");
          gchar *caps_text = gst_caps_to_string(caps);
          json_builder_add_string_value(builder.get(), caps_text);
          g_free(caps_text);
          json_builder_end_object(builder.get());
        }
        if (caps)
          gst_caps_unref(caps);
        g_value_reset(&pad_value);
      }
      if (G_VALUE_TYPE(&pad_value))
        g_value_unset(&pad_value);
      gst_iterator_free(pads);
      json_builder_end_array(builder.get());
      json_builder_end_object(builder.get());
    }
    g_value_reset(&value);
  }
  if (result != GST_ITERATOR_DONE)
    complete = false;
  if (G_VALUE_TYPE(&value))
    g_value_unset(&value);
  gst_iterator_free(elements);
  json_builder_end_array(builder.get());
  json_builder_set_member_name(builder.get(), "usesSystemMemoryCompositor");
  json_builder_add_boolean_value(builder.get(), system_compositor);
  json_builder_set_member_name(builder.get(), "snapshotComplete");
  json_builder_add_boolean_value(builder.get(), complete);
  json_builder_end_object(builder.get());
  output(builder.get());
}

struct PipelineState {
  GESPipeline *pipeline = nullptr;
  ~PipelineState() {
    if (pipeline) {
      gst_element_set_state(GST_ELEMENT(pipeline), GST_STATE_NULL);
      gst_object_unref(pipeline);
    }
  }
};
bool is_cancelled(const char *cancel_file, unsigned long parent_pid) {
  if (g_file_test(cancel_file, G_FILE_TEST_EXISTS))
    return true;
#ifdef _WIN32
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
  if (!parent)
    return true;
  const bool gone = WaitForSingleObject(parent, 0) == WAIT_OBJECT_0;
  CloseHandle(parent);
  return gone;
#else
  (void)parent_pid;
  return false;
#endif
}
int render(const char *plan_path, const char *output_path, const char *cancel_file,
           unsigned long parent_pid) {
  auto parser = owned(json_parser_new());
  GError *error = nullptr;
  if (!json_parser_load_from_file(parser.get(), plan_path, &error))
    throw std::runtime_error(error ? error->message : "Cannot load media plan");
  JsonObject *plan = json_node_get_object(json_parser_get_root(parser.get()));
  if (json_object_get_int_member(plan, "version") != 1)
    throw std::runtime_error("Unsupported media plan version");
  JsonObject *source = json_object_get_object_member(plan, "timeline");
  auto *fps = json_object_get_object_member(source, "frameRate");
  const int width = int(json_object_get_int_member(source, "width")),
            height = int(json_object_get_int_member(source, "height"));
  const int num = int(json_object_get_int_member(fps, "numerator")),
            den = int(json_object_get_int_member(fps, "denominator"));
  const auto timebase = json_object_get_int_member(source, "timebase");
  if (width <= 0 || height <= 0 || num <= 0 || den <= 0 || timebase <= 0)
    throw std::runtime_error("Invalid video settings");
  const auto profile_name = str(plan, "profile");
  const bool mp4 = profile_name == "mp4-h264";
  // The default H.264 profile is deterministic software encoding. A discoverable
  // NVENC factory does not prove that the driver can open an encoding session.
  if (mp4) {
    auto encoder = owned(gst_element_factory_find("x264enc"));
    if (!encoder)
      throw std::runtime_error("The mp4-h264 profile requires x264enc");
    gst_plugin_feature_set_rank(GST_PLUGIN_FEATURE(encoder.get()), GST_RANK_PRIMARY + 1000);
  }
  if (mp4 && (width % 2 || height % 2))
    throw std::runtime_error("H.264 I420 output requires even width and height");
  std::map<std::string, JsonObject *> assets;
  JsonArray *asset_list = json_object_get_array_member(plan, "assets");
  for (guint i = 0; i < json_array_get_length(asset_list); i++) {
    auto *asset = json_array_get_object_element(asset_list, i);
    assets[str(asset, "id")] = asset;
  }
  auto timeline = owned(ges_timeline_new_audio_video());
  g_object_ref_sink(timeline.get());
  GstCaps *restriction = gst_caps_new_simple(
      "video/x-raw", "width", G_TYPE_INT, width, "height", G_TYPE_INT, height, "framerate",
      GST_TYPE_FRACTION, num, den, "pixel-aspect-ratio", GST_TYPE_FRACTION, 1, 1, nullptr);
  GList *tracks = ges_timeline_get_tracks(timeline.get());
  for (GList *item = tracks; item; item = item->next) {
    auto *track = GES_TRACK(item->data);
    if (track->type == GES_TRACK_TYPE_VIDEO)
      ges_track_set_restriction_caps(track, restriction);
  }
  g_list_free_full(tracks, g_object_unref);
  std::map<std::string, GESLayer *> layers;
  std::map<std::string, JsonObject *> track_settings;
  bool audio_solo = false;
  auto flag = [](JsonObject *obj, const char *key) { return json_object_has_member(obj, key) && json_object_get_boolean_member(obj, key); };
  std::map<std::string, std::string> kinds;
  auto *track_list = json_object_get_array_member(source, "tracks");
  for (guint i = 0; i < json_array_get_length(track_list); i++) {
    auto *track = json_array_get_object_element(track_list, i);
    track_settings[str(track, "id")] = track;
    if (str(track,"kind") == "audio" && flag(track,"solo")) audio_solo = true;
    auto *layer = ges_layer_new();
    ges_layer_set_priority(layer, i + 1);
    if (!ges_timeline_add_layer(timeline.get(), layer))
      throw std::runtime_error("Cannot add GES layer");
    layers[str(track, "id")] = layer;
    kinds[str(track, "id")] = str(track, "kind");
  }
  JsonArray *clips = json_object_get_array_member(source, "clips");
  GstClockTime total = 0;
  std::map<std::string, std::vector<std::pair<gint64, gint64>>> intervals;
  for (guint i = 0; i < json_array_get_length(clips); i++) {
    if (is_cancelled(cancel_file, parent_pid)) {
      event("cancelled");
      gst_caps_unref(restriction);
      return 0;
    }
    auto *clip = json_array_get_object_element(clips, i);
    const auto asset_id = str(clip, "assetId"), track_id = str(clip, "trackId");
    if (!assets.count(asset_id) || !layers.count(track_id))
      throw std::runtime_error("Unresolved asset or track reference");
    if (json_object_has_member(clip, "extensions") &&
        json_object_get_size(json_object_get_object_member(clip, "extensions")) > 0)
      throw std::runtime_error("This media worker cannot render clip extensions yet");
    const auto start_ticks = json_object_get_int_member(clip, "startTicks"),
               duration_ticks = json_object_get_int_member(clip, "durationTicks"),
               in_ticks = json_object_get_int_member(clip, "inTicks");
    if (start_ticks < 0 || duration_ticks <= 0 || in_ticks < 0)
      throw std::runtime_error("Invalid clip range");
    for (const auto &interval : intervals[track_id])
      if (start_ticks < interval.second && start_ticks + duration_ticks > interval.first)
        throw std::runtime_error("Overlapping clips on the same track are not supported by this "
                                 "adapter yet; use separate tracks");
    intervals[track_id].push_back({start_ticks, start_ticks + duration_ticks});
    const auto uri = str(assets[asset_id], "uri");
    const auto kind = str(assets[asset_id], "mediaType");
    auto asset = owned(ges_uri_clip_asset_request_sync(uri.c_str(), &error));
    if (!asset) {
      std::string message = error ? error->message : "Cannot discover source asset";
      g_clear_error(&error);
      throw std::runtime_error(message);
    }
    const auto start = gst_util_uint64_scale(start_ticks, GST_SECOND, timebase),
               in = gst_util_uint64_scale(in_ticks, GST_SECOND, timebase),
               duration = gst_util_uint64_scale(duration_ticks, GST_SECOND, timebase);
    GESTrackType formats = kinds[track_id] == "audio" ? GES_TRACK_TYPE_AUDIO
                           : kind == "image" || json_object_has_member(clip,"linkGroup")
                               ? GES_TRACK_TYPE_VIDEO
                               : GESTrackType(GES_TRACK_TYPE_AUDIO | GES_TRACK_TYPE_VIDEO);
    GESClip *added =
        ges_layer_add_asset(layers[track_id], GES_ASSET(asset.get()), start, in, duration, formats);
    if (!added)
      throw std::runtime_error("GES rejected clip timing or media formats");
    auto *settings = track_settings[track_id];
    GList *children = ges_container_get_children(GES_CONTAINER(added), FALSE);
    for (GList *item = children; item; item = item->next) {
      if (!GES_IS_TRACK_ELEMENT(item->data)) continue;
      auto *element = GES_TRACK_ELEMENT(item->data);
      const bool is_audio = ges_track_element_get_track_type(element) == GES_TRACK_TYPE_AUDIO;
      const bool active = !flag(clip,"disabled") && !flag(settings,"disabled") && (!is_audio || (!flag(settings,"muted") && (!audio_solo || flag(settings,"solo"))));
      ges_track_element_set_active(element, active);
    }
    g_list_free_full(children, g_object_unref);
    total = std::max(total, start + duration);
  }
  if (json_object_has_member(plan,"subtitles")) {
    auto *documents = json_object_get_array_member(plan,"subtitles");
    auto *subtitle_layer = ges_layer_new();
    ges_layer_set_priority(subtitle_layer,0);
    if (!ges_timeline_add_layer(timeline.get(),subtitle_layer)) throw std::runtime_error("Cannot add subtitle layer");
    for (guint d=0;d<json_array_get_length(documents);d++) {
      auto *doc = json_object_get_object_member(json_array_get_object_element(documents,d),"document");
      const auto subtitle_timebase=json_object_get_int_member(doc,"timebase");
      if(subtitle_timebase<=0) throw std::runtime_error("Invalid subtitle timebase");
      auto *cues=json_object_get_array_member(doc,"cues");
      for(guint c=0;c<json_array_get_length(cues);c++) {
        auto *cue=json_array_get_object_element(cues,c);
        const auto start_ticks=json_object_get_int_member(cue,"startTicks"),end_ticks=json_object_get_int_member(cue,"endTicks");
        if(start_ticks<0 || end_ticks<=start_ticks)throw std::runtime_error("Invalid subtitle timing");
        auto *title=ges_title_clip_new();
        const auto start=gst_util_uint64_scale(start_ticks,GST_SECOND,subtitle_timebase);
        if(start>=total) {g_object_unref(title);continue;}
        const auto duration=std::min(gst_util_uint64_scale(end_ticks-start_ticks,GST_SECOND,subtitle_timebase),total-start);
        ges_timeline_element_set_start(GES_TIMELINE_ELEMENT(title),start);
        ges_timeline_element_set_duration(GES_TIMELINE_ELEMENT(title),duration);
        gchar *escaped=g_markup_escape_text(str(cue,"text").c_str(),-1);
        ges_title_clip_set_text(title,escaped);g_free(escaped);
        const std::string font="Microsoft YaHei " + std::to_string(std::max(18,height/30));
        ges_title_clip_set_font_desc(title,font.c_str());
        ges_title_clip_set_halignment(title,GES_TEXT_HALIGN_CENTER);
        ges_title_clip_set_valignment(title,GES_TEXT_VALIGN_POSITION);
        ges_title_clip_set_ypos(title,0.90);
        ges_title_clip_set_color(title,0xffffffff);
        ges_title_clip_set_background(title,0x00000000);
        if(!ges_layer_add_clip(subtitle_layer,GES_CLIP(title)))throw std::runtime_error("GES rejected subtitle clip");
      }
    }
  }
  if (total == 0)
    throw std::runtime_error("Timeline is empty");
  if (!ges_timeline_commit_sync(timeline.get()))
    throw std::runtime_error("GES timeline commit failed");
  PipelineState state;
  state.pipeline = ges_pipeline_new();
  g_object_ref_sink(state.pipeline);
  if (!ges_pipeline_set_timeline(state.pipeline, timeline.get()))
    throw std::runtime_error("Cannot attach GES timeline");
  GstCaps *container_caps =
      gst_caps_from_string(mp4 ? "video/quicktime,variant=iso" : "video/webm");
  auto *profile = gst_encoding_container_profile_new("workstation", "Workstation render",
                                                     container_caps, nullptr);
  gst_caps_unref(container_caps);
  GstCaps *video_caps = gst_caps_from_string(mp4 ? "video/x-h264" : "video/x-vp8");
  auto *video_profile = gst_encoding_video_profile_new(video_caps, nullptr, restriction, 0);
  gst_caps_unref(video_caps);
  gst_caps_unref(restriction);
  gst_encoding_container_profile_add_profile(profile, GST_ENCODING_PROFILE(video_profile));
  GstCaps *audio_caps = gst_caps_from_string(mp4 ? "audio/mpeg,mpegversion=4" : "audio/x-vorbis");
  GstCaps *audio_restriction = gst_caps_from_string("audio/x-raw,rate=48000,channels=2");
  auto *audio_profile = gst_encoding_audio_profile_new(audio_caps, nullptr, audio_restriction, 0);
  gst_caps_unref(audio_caps);
  gst_caps_unref(audio_restriction);
  gst_encoding_container_profile_add_profile(profile, GST_ENCODING_PROFILE(audio_profile));
  gchar *output_uri = gst_filename_to_uri(output_path, &error);
  if (!output_uri)
    throw std::runtime_error(error ? error->message : "Invalid output path");
  bool configured =
      ges_pipeline_set_render_settings(state.pipeline, output_uri, GST_ENCODING_PROFILE(profile));
  g_free(output_uri);
  g_object_unref(profile);
  if (!configured || !ges_pipeline_set_mode(state.pipeline, GES_PIPELINE_MODE_RENDER))
    throw std::runtime_error("Cannot configure GES rendering");
  auto bus = owned(gst_element_get_bus(GST_ELEMENT(state.pipeline)));
  if (gst_element_set_state(GST_ELEMENT(state.pipeline), GST_STATE_PLAYING) ==
      GST_STATE_CHANGE_FAILURE)
    throw std::runtime_error("Cannot start GES render pipeline");
  event("progress", "", 0);
  bool audited = false;
  for (;;) {
    if (is_cancelled(cancel_file, parent_pid)) {
      gst_element_set_state(GST_ELEMENT(state.pipeline), GST_STATE_NULL);
      event("cancelled");
      return 0;
    }
    while (g_main_context_iteration(nullptr, FALSE)) {
    }
    GstMessage *message = gst_bus_timed_pop_filtered(
        bus.get(), 100 * GST_MSECOND,
        GstMessageType(GST_MESSAGE_ERROR | GST_MESSAGE_EOS | GST_MESSAGE_ASYNC_DONE));
    if (message) {
      if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ASYNC_DONE) {
        if (!audited) {
          pipeline_audit(GST_ELEMENT(state.pipeline));
          audited = true;
        }
        gst_message_unref(message);
        continue;
      }
      if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
        gchar *debug = nullptr;
        gst_message_parse_error(message, &error, &debug);
        std::string reason = error ? error->message : "Render error";
        if (debug)
          std::cerr << debug << std::endl;
        g_free(debug);
        g_clear_error(&error);
        gst_message_unref(message);
        throw std::runtime_error(reason);
      }
      gst_message_unref(message);
      if (!audited)
        pipeline_audit(GST_ELEMENT(state.pipeline));
      gst_element_set_state(GST_ELEMENT(state.pipeline), GST_STATE_NULL);
      event("complete", "", 1);
      return 0;
    }
    gint64 position = 0;
    if (gst_element_query_position(GST_ELEMENT(state.pipeline), GST_FORMAT_TIME, &position))
      event("progress", "", std::min(0.999, double(position) / total));
  }
}
int main(int argc, char **argv) {
#ifdef _WIN32
  gchar **unicode_args = g_win32_get_command_line();
  argv = unicode_args;
  argc = g_strv_length(unicode_args);
#endif
  gst_init(nullptr, nullptr);
  if (!ges_init()) {
    event("error", "Cannot initialize GES");
    return 1;
  }
  int result = 0;
  try {
    if (argc == 2 && std::string(argv[1]) == "--probe")
      probe();
    else if (argc == 3 && std::string(argv[1]) == "--inspect")
      inspect(argv[2]);
    else if (argc == 6 && std::string(argv[1]) == "--render")
      result = render(argv[2], argv[3], argv[4], std::stoul(argv[5]));
    else
      throw std::runtime_error(
          "Usage: --probe | --inspect URI | --render PLAN OUTPUT CANCEL_FILE PARENT_PID");
  } catch (const std::exception &error) {
    event("error", error.what());
    result = 1;
  }
  ges_deinit();
  gst_deinit();
#ifdef _WIN32
  g_strfreev(unicode_args);
#endif
  return result;
}
