import { getZoomAccessToken } from "./src/auth/zoomOAuth.ts";
import { env } from "./src/env.ts";
const token = await getZoomAccessToken();
const uid = env.ZOOM_DEFAULT_USER_ID;
const res = await fetch(`https://api.zoom.us/v2/phone/sms/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    message: "DashDialer SMS probe via new API",
    sender: { user_id: uid, phone_number: "+19163065045" },
    to_members: [{ phone_number: "+12025550101" }],
  }),
});
console.log("status", res.status);
console.log(await res.text());
