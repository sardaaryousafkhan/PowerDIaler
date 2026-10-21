import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useLicense } from "../licenseContext.js";

export function LicenseBanner(): ReactElement | null {
  const { isDesktop, blocksPaid, status, loading } = useLicense();
  if (!isDesktop || loading) return null;

  if (blocksPaid) {
    const why =
      status?.reason === "grace_expired"
        ? "DashDialer could not reach derivedstudio.com for 7 days."
        : status?.status === "revoked"
          ? "This license was revoked by the seller."
          : status?.status === "expired"
            ? "This license has expired."
            : status?.status === "machine_limit"
              ? "This license is already used on the maximum number of computers."
              : status?.error || "";
    return (
      <div className="callout" style={{ margin: "0 0 16px", borderColor: "rgba(217,72,95,.35)", background: "rgba(217,72,95,.08)" }}>
        <strong>License inactive.</strong> Paid features (start campaigns, texts, import) are locked. {why}{" "}
        <Link className="text-link" to="/license">Activate or renew</Link>
        {" · "}
        <a className="text-link" href="https://derivedstudio.com/dashdialer/" target="_blank" rel="noreferrer">
          derivedstudio.com
        </a>
      </div>
    );
  }

  // Running on cached approval (offline or license server down): soft warning with days left.
  if (status?.reason === "grace" && typeof status.graceRemainingMs === "number") {
    const days = Math.max(1, Math.ceil(status.graceRemainingMs / 86_400_000));
    return (
      <div className="callout" style={{ margin: "0 0 16px", borderColor: "rgba(234,179,8,.4)", background: "rgba(234,179,8,.08)" }}>
        <strong>Offline mode.</strong> Last license check could not reach derivedstudio.com. Paid features stay unlocked for{" "}
        {days} more day{days === 1 ? "" : "s"}; reconnect to the internet to refresh.{" "}
        <Link className="text-link" to="/license">Check now</Link>
      </div>
    );
  }
  return null;
}
