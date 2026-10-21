import { getZoomAccessToken } from "../../services/zoom-phone-bridge/src/auth/zoomOAuth.ts";
import { env } from "../../services/zoom-phone-bridge/src/env.ts";

const token = await getZoomAccessToken();
console.log("token?", !!token);
const uid = env.ZOOM_DEFAULT_USER_ID;
const r = await fetch(`https://api.zoom.us/v2/phone/users/${uid}/settings`, {
  headers: { authorization: `Bearer ${token}` },
});
console.log("settings status", r.status);
const j = await r.json();
console.log("sms:", JSON.stringify(j.sms, null, 2));
const r2 = await fetch(`https://api.zoom.us/v2/phone/users/${uid}`, {
  headers: { authorization: `Bearer ${token}` },
});
const u = await r2.json();
console.log(
  "user:",
  JSON.stringify(
    { id: u.id, email: u.email, phone_numbers: u.phone_numbers, site: u.site },
    null,
    2,
  ),
);

// Try PATCH enable SMS if API allows
const patch = await fetch(`https://api.zoom.us/v2/phone/users/${uid}/settings`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ sms: { enable: true } }),
});
console.log("patch status", patch.status, await patch.text().then((t) => t.slice(0, 400)));

const r3 = await fetch(`https://api.zoom.us/v2/phone/users/${uid}/settings`, {
  headers: { authorization: `Bearer ${token}` },
});
const j3 = await r3.json();
console.log("sms after patch:", JSON.stringify(j3.sms, null, 2));
