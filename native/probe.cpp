#include <iostream>
#ifdef WORKSTATION_HAVE_GES
#include <ges/ges.h>
#endif

int main() {
#ifdef WORKSTATION_HAVE_GES
  gst_init(nullptr, nullptr);
  if (!ges_init()) {
    std::cout << R"({"gesAvailable":false,"renderAvailable":false,"reason":"ges_init failed"})" << '\n';
    return 1;
  }
  guint major, minor, micro, nano;
  gst_version(&major, &minor, &micro, &nano);
  std::cout << "{\"gesAvailable\":true,\"renderAvailable\":false,\"gstreamerVersion\":\""
            << major << '.' << minor << '.' << micro
            << "\",\"gpuSurfaceValidation\":\"pending\"}" << '\n';
  ges_deinit();
  gst_deinit();
#else
  std::cout << R"({"gesAvailable":false,"renderAvailable":false,"gpuSurfaceValidation":"pending","reason":"GES development libraries were not found at build time"})" << '\n';
#endif
  return 0;
}
