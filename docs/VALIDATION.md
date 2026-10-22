# Changes and host validation

## 2026-10-22 protocol-2 publication

The multi-client bridge is now published from the user's Claude implementation. The host editing/export observations in this document predate that transport update. Publication checks build TypeScript and exercise real local TCP connections with mocked host execution; Premiere was not reachable for a new host smoke test. See [protocol-2 source, migration and validation scope](PROTOCOL2.md).

## Provenance

Community adaptation of https://github.com/antipaster/Adobe-Premiere-Pro-MCP . Original MIT license retained. This report covers the local PR 2023 adaptation, not upstream's complete tool catalog.

## Fixes

| Area | Original problem observed | Adaptation |
|---|---|---|
| CEP manifest | Required CSXS 12 did not match PR 2023's CEP 11 runtime | Require CSXS 11 |
| Local bridge | Listener used a wildcard interface and panel used localhost | Use 127.0.0.1 at both ends |
| Dependencies | Direct zod import lacked an explicit dependency | Declare zod 3.25.76; refresh npm lock |
| Razor | Passing ticks reported success without splitting the clip | Format time using active sequence timebase/display format before QE razor |
| Clip metadata | enabled was actually reporting whether a clip was selected | Read !clip.disabled, report selection separately |
| Clip volume | English-only lookup failed on Chinese UI; raw value was treated as dB | Match Internal Volume component and Level/级别 property; convert normalized value to/from dB and read back |
| Installation | Original batch installer replaced links and configured other clients | Resolve this checkout dynamically, detect conflicts, build first, print client configuration |

## Observed inside Premiere

Environment: Windows, Premiere Pro 23.0.0 build 63, Chinese UI, CEP 11.5.2. MCP handshake, tool listing, application version and project reads succeeded.

An 8-second, 1280×720, 30 fps synthetic video with a 440 Hz mono audio tone was imported into a separate test project. A sequence was created from it. Single-track razor calls split both video and audio at 2 and 4 seconds. The middle 2-second sections were removed, and the final sections were moved to timeline time 2 seconds.

Verified video and audio timeline layout:

| Timeline interval | Source interval |
|---|---|
| 0–2 s | 0–2 s |
| 2–6 s | 4–8 s |

The second audio segment was set to −6 dB; the host read back approximately −5.999999709 dB. The project was saved and exported using Premiere's direct export and an installed H.264 preset.

Export verification:

- H.264 1280×720, 30 fps, 180 frames, 6.000 seconds; AAC audio, 6 seconds.
- Decoded output frames at 1, 3 and 5 seconds were visually compared against source frames at 1, 5 and 7 seconds, respectively; content matched the intended edit.
- FFmpeg blackdetect with `d=0.1:pix_th=0.1:pic_th=0.98` found no qualifying black interval. This threshold-based check is not proof that every possible visual issue is absent.
- Segment mean levels were approximately −24.1 and −30.1 dB, consistent with the requested 6 dB reduction.

Test media, screenshots, local client scripts, project files, credentials and machine-specific configurations are not distributed in this repository.

## Limits and repeatability

The added Node regression suite loads the real JSX functions with small host mocks to check locale lookup, volume boundaries, readback, enabled/selected state and formatted razor calls. Those tests do not prove QE behavior inside another Premiere release.

The all-track razor wrapper, alternate frame-rate/display modes, stereo/surround volume, audio keyframes, other Premiere releases and the entire inherited tool catalog were not host-validated. Repeat the short import/edit/export procedure on each target computer before using a long project. A successful MCP response or Connected indicator alone does not prove a successful edit.
