# Belgian outlets: research for later

Parked on 2026-10-25, when the MVP was cut back to VRT NWS alone. Nothing here
is used by the app. It is kept so the other outlets can be added later without
redoing the research.

| File | What it is |
| --- | --- |
| `outlets.json` | 31 Belgian outlets: each one's checked streams (feed URLs, sections), quirks, and the gaps still open. `vrtApi` lists VRT's other backend endpoints. |
| `rossel-ipm-notes.json` | Detail on the Rossel (Le Soir, Sudinfo) and IPM (La Libre, DH) platforms. |
| `sporza.json` | Sporza, VRT's sports brand: feeds and backend pages. |
| `build-workflow.js` | The multi-agent build that was stopped: one agent per publishing platform writing outlet modules. |

The feeds were checked by hand on 2026-10-25. Re-check every URL before using it,
because sections move and feeds get dropped.

## Resuming

- Add one outlet at a time, as a module in `integrations/outlets/<id>.mjs`. Try it
  with `npm run check -- --module integrations/outlets/<id>.mjs`, then register it
  in `integrations/outlets/index.mjs`.
- Outlets on one publishing platform (DPG Media, Mediahuis, Rossel, IPM) share
  their feed quirks. Once two outlets need the same fix, put the shared code in
  `integrations/outlets/shared/<platform>.mjs`.
- `build-workflow.js` can be relaunched with the Workflow tool (`scriptPath`).
  Its scratchpad paths point to a temporary folder that is gone, so point them at
  this folder first.
- The feed samples (about 77 MB) were not kept; fetch them again from the URLs in
  `outlets.json`.

## Left out on purpose

- **GrenzEcho**: Akamai bot protection answers 403. We do not work around bot protection.
- **Belga**: a licensed news agency, and robots.txt disallows everything.
