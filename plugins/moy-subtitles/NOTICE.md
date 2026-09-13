# Source and adaptation

This plugin is distributed under AGPL-3.0, with the original license in LICENSE.
Upstream: https://github.com/Moyf/moys-asr-workflow (Moyf).

vendor/maw-srt.js extracts parseSrtTimestamp/parseSrtSegments from web/editor.js.
vendor/maw-decode.js extracts decodeSubtitleText from web/editor-utils.js.
Functions are preserved; file layout is changed for the workstation plugin.
The surrounding page and host bridge are workstation adaptations under the same license.
No upstream .env, personal configuration, media or model weights are included.
The original web editor sources are now vendored in upstream/web and compiled
by scripts/build-moy-editor.mjs into editor.html. Source checkout HEAD at import:
678eb32704883065ad3a910f31953e1db0c4e5e4.
The loadMediaFile function accepts an optional workstation streaming URL; this
avoids copying whole project videos into a browser Blob. URL-based loading does
not generate waveform samples from the entire media file. Local file loading
retains the upstream waveform path. maw-host-bridge.js adds project/media exchange.
The ASR runners have not been connected to the workstation yet.
