import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useLicense } from "../licenseContext.js";
import { useNotifier } from "../notifications/context.js";

type CampaignKind = "DIAL" | "SMS";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the audio file."));
    reader.readAsDataURL(blob);
  });
}

export function CampaignNew({ kind }: { kind: CampaignKind }): ReactElement {
  const nav = useNavigate();
  const { pushToast } = useNotifier();
  const { blocksPaid } = useLicense();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fromPhone, setFromPhone] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [smsTemplate, setSmsTemplate] = useState("");
  const [consentNotes, setConsentNotes] = useState("");
  const [consentAttested, setConsentAttested] = useState(false);
  const [voicemailDropEnabled, setVoicemailDropEnabled] = useState(false);
  const [voicemailMessage, setVoicemailMessage] = useState("");
  const [voicemailAudioDataUrl, setVoicemailAudioDataUrl] = useState("");
  const [voicemailAudioPreviewUrl, setVoicemailAudioPreviewUrl] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "processing">("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const voicemailUploadRef = useRef<HTMLInputElement | null>(null);

  const supportsRecording = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    [],
  );

  function clearPreviewUrl() {
    if (voicemailAudioPreviewUrl) {
      URL.revokeObjectURL(voicemailAudioPreviewUrl);
    }
  }

  function stopActiveStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  useEffect(() => {
    let mounted = true;
    void api.integrations
      .get()
      .then((r) => {
        if (!mounted) return;
        const match = r.catalog.find((c) => c.id === r.preference.preferredIntegrationKey);
        setProviderName(match?.name ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setProviderName(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      stopActiveStream();
      clearPreviewUrl();
    };
  }, [voicemailAudioPreviewUrl]);

  async function startRecording() {
    if (!supportsRecording || recordingState !== "idle") return;
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopActiveStream();
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      const candidateMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType =
        candidateMimeTypes.find((value) => {
          try {
            return typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(value);
          } catch {
            return false;
          }
        }) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingError("Recording failed. Please try again.");
        setRecordingState("idle");
        stopActiveStream();
      };
      recorder.onstop = () => {
        void (async () => {
          try {
            setRecordingState("processing");
            const blob = new Blob(mediaChunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            });
            if (!blob.size) {
              setRecordingError("The recording was empty. Please try again.");
              return;
            }
            const nextPreviewUrl = URL.createObjectURL(blob);
            const nextDataUrl = await blobToDataUrl(blob);
            clearPreviewUrl();
            setVoicemailAudioPreviewUrl(nextPreviewUrl);
            setVoicemailAudioDataUrl(nextDataUrl);
            setRecordingError(null);
          } catch (error) {
            setRecordingError(error instanceof Error ? error.message : "Could not finish the recording.");
          } finally {
            mediaRecorderRef.current = null;
            mediaChunksRef.current = [];
            stopActiveStream();
            setRecordingState("idle");
          }
        })();
      };
      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      stopActiveStream();
      setRecordingError(error instanceof Error ? error.message : "Microphone access was not granted.");
      setRecordingState("idle");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recordingState === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  function clearRecording() {
    clearPreviewUrl();
    setVoicemailAudioPreviewUrl("");
    setVoicemailAudioDataUrl("");
    setRecordingError(null);
    if (voicemailUploadRef.current) {
      voicemailUploadRef.current.value = "";
    }
  }

  async function onUploadVoicemailFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setRecordingError("Please upload an audio file for voicemail drop.");
      return;
    }
    try {
      setRecordingError(null);
      setRecordingState("processing");
      const nextPreviewUrl = URL.createObjectURL(file);
      const nextDataUrl = await blobToDataUrl(file);
      clearPreviewUrl();
      setVoicemailAudioPreviewUrl(nextPreviewUrl);
      setVoicemailAudioDataUrl(nextDataUrl);
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "Could not load the audio file.");
    } finally {
      setRecordingState("idle");
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    if (blocksPaid) {
      const msg = "License inactive. Activate at License in the sidebar, or renew on derivedstudio.com.";
      setErr(msg);
      pushToast({ variant: "warning", title: "License required", message: msg });
      setBusy(false);
      return;
    }
    if (!consentAttested) {
      const msg = "Please confirm consent attestation before creating the campaign.";
      setErr(msg);
      pushToast({ variant: "warning", title: "Attestation required", message: msg });
      setBusy(false);
      return;
    }
    if (kind === "DIAL" && voicemailDropEnabled && !voicemailMessage.trim() && !voicemailAudioDataUrl.trim()) {
      const msg = "Add a voicemail drop message or record audio before creating the campaign.";
      setErr(msg);
      pushToast({ variant: "warning", title: "Voicemail drop incomplete", message: msg });
      setBusy(false);
      return;
    }
    if (recordingState !== "idle") {
      const msg = "Finish recording before creating the campaign.";
      setErr(msg);
      pushToast({ variant: "warning", title: "Recording in progress", message: msg });
      setBusy(false);
      return;
    }

    const payload =
      kind === "DIAL"
        ? {
            kind: "DIAL" as const,
            name,
            fromPhone,
            voiceMessage,
            voicemailDropEnabled,
            voicemailMessage: voicemailMessage || undefined,
            voicemailAudioDataUrl: voicemailAudioDataUrl || undefined,
            smsTemplate: smsTemplate || undefined,
            consentNotes,
            consentAttested,
          }
        : {
            kind: "SMS" as const,
            name,
            fromPhone,
            smsTemplate,
            consentNotes,
            consentAttested,
          };
    const fd = new FormData(e.currentTarget);

    const csvField = fd.get("contactsCsv");
    const csvFile =
      csvField instanceof File && csvField.size > 0 && csvField.name.length > 0 ? csvField : null;

    if (kind === "SMS" && !csvFile) {
      const msg = "Upload a CSV contact list once to create this SMS campaign.";
      setErr(msg);
      pushToast({ variant: "warning", title: "CSV required", message: msg });
      setBusy(false);
      return;
    }

    try {
      const c = (await api.campaigns.create(payload)) as { id: string };
      if (csvFile) {
        try {
          const imp = await api.campaigns.importCsv(c.id, csvFile);
          if (kind === "SMS" && imp.created < 1) {
            pushToast({
              variant: "warning",
              title: "Campaign created, but no contacts imported",
              message: "Fix the CSV (needs a phone column) and use Add contacts on the campaign page.",
              durationMs: 8000,
            });
          } else {
            const dup =
              (imp.skippedDuplicate ?? 0) > 0 ? `, ${imp.skippedDuplicate} duplicates skipped` : "";
            const dupNote =
              (imp.skippedRows?.length ?? 0) > 0 && (imp.skippedDuplicate ?? 0) > 0
                ? " Duplicate numbers in the file were skipped."
                : "";
            pushToast({
              variant: "success",
              title: "Campaign created",
              message: `${name}: ${imp.created} imported${dup}.${dupNote}`,
              durationMs: 5500,
            });
          }
        } catch (impErr) {
          const impMsg = impErr instanceof Error ? impErr.message : String(impErr);
          pushToast({
            variant: "warning",
            title: "Created; import incomplete",
            message:
              kind === "SMS"
                ? `${impMsg} Use Add contacts on the campaign page (only if the list is empty).`
                : `${impMsg} Re-upload CSV from the campaign detail screen.`,
            durationMs: 8000,
          });
          pushToast({
            variant: "success",
            title: "Campaign created",
            message: `${name} is open for review.`,
            durationMs: 4500,
          });
        }
      } else {
        pushToast({
          variant: "success",
          title: "Campaign created",
          message: `${name} is open for review.`,
          durationMs: 4500,
        });
      }
      nav(`/campaigns/${c.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Create failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  const title = kind === "DIAL" ? "New voice campaign" : "New SMS campaign";
  const submitDisabled =
    busy || blocksPaid || recordingState === "recording" || recordingState === "processing";

  return (
    <div className="detail-stack">
      <p className="back-row">
        <Link className="text-link" to="/new">
          ← Back
        </Link>
      </p>

      <header className="page-hero">
        <h2 className="page-hero__title">{title}</h2>
        <p className="page-hero__lede">
          {kind === "DIAL"
            ? "Name the campaign, set caller ID, define the agent script, and optionally prepare voicemail drop audio."
            : "Name the campaign, set the sending number, write the SMS, and upload your contact CSV once."}
        </p>
      </header>

      {blocksPaid ? (
        <p className="callout">
          License inactive. <Link className="text-link" to="/license">Activate your key</Link> before creating campaigns.
        </p>
      ) : null}

      <form className="panel panel-lift form-card" onSubmit={onSubmit}>
        <div className="row">
          <div>
            <label htmlFor="camp-name">Campaign name</label>
            <input
              id="camp-name"
              name="name"
              required
              placeholder="e.g. Tuesday follow-ups"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="camp-from">{providerName ?? "Preferred provider"} sending number</label>
            <input
              id="camp-from"
              name="fromPhone"
              required
              placeholder="+12025550101"
              value={fromPhone}
              onChange={(e) => setFromPhone(e.target.value)}
            />
            <p className="field-hint">
              Use the number from your phone provider (Vonage/Twilio), with country code — e.g.{" "}
              <code className="mono">+12025550101</code>. US numbers like{" "}
              <code className="mono">(202) 555-0101</code> are also accepted.
            </p>
          </div>
        </div>
        {kind === "DIAL" ? (
          <>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="camp-voice">Pre-written script</label>
              <textarea
                id="camp-voice"
                name="voiceMessage"
                required
                maxLength={500}
                placeholder="What the agent should say when the call connects..."
                value={voiceMessage}
                onChange={(e) => setVoiceMessage(e.target.value)}
              />
              <p className="field-hint">
                This becomes the pre-written script agents can open after the campaign starts.
              </p>
            </div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="camp-sms-ref">Optional SMS template</label>
              <textarea
                id="camp-sms-ref"
                name="smsTemplate"
                maxLength={1600}
                placeholder="Optional; editable later"
                value={smsTemplate}
                onChange={(e) => setSmsTemplate(e.target.value)}
              />
            </div>
            <section className="campaign-voicemail-card" style={{ marginTop: 14 }}>
              <div className="campaign-voicemail-card__header">
                <div>
                  <h3 className="section-title" style={{ fontSize: "1rem", marginBottom: 6 }}>
                    Voice Mail Drop
                  </h3>
                  <p className="section-lede" style={{ marginBottom: 0 }}>
                    When voicemail is detected, play a dedicated drop message after the beep. Recorded audio is used
                    first; typed text is the fallback.
                  </p>
                </div>
              </div>
              <label className="checkbox-row" style={{ marginTop: 12 }}>
                <input
                  name="voicemailDropEnabled"
                  type="checkbox"
                  checked={voicemailDropEnabled}
                  onChange={(event) => setVoicemailDropEnabled(event.currentTarget.checked)}
                />
                <span>Enable voicemail drop for this voice campaign.</span>
              </label>
              {voicemailDropEnabled ? (
                <div className="campaign-voicemail-card__body">
                  <div>
                    <label htmlFor="camp-voicemail-message">Voicemail text fallback</label>
                    <textarea
                      id="camp-voicemail-message"
                      name="voicemailMessage"
                      maxLength={500}
                      placeholder="Hi, this is Alex from DashDialer. Sorry we missed you..."
                      value={voicemailMessage}
                      onChange={(event) => setVoicemailMessage(event.target.value)}
                    />
                    <p className="field-hint">
                      Use this when you want Twilio to speak the message if no recording is attached.
                    </p>
                  </div>
                  <div className="voicemail-recorder">
                    <div className="voicemail-recorder__toolbar">
                      <span className="fw-medium">Recorded voicemail</span>
                      <div className="voicemail-recorder__actions">
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() => void startRecording()}
                          disabled={!supportsRecording || recordingState !== "idle"}
                        >
                          {supportsRecording ? "Record message" : "Recording unavailable"}
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={stopRecording}
                          disabled={recordingState !== "recording"}
                        >
                          Stop
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() => voicemailUploadRef.current?.click()}
                          disabled={recordingState === "recording" || recordingState === "processing"}
                        >
                          Upload audio
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={clearRecording}
                          disabled={!voicemailAudioDataUrl}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <input
                      ref={voicemailUploadRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm"
                      style={{ display: "none" }}
                      onChange={(event) => void onUploadVoicemailFile(event.target.files?.[0] ?? null)}
                    />
                    <p className="field-hint" style={{ marginTop: 0 }}>
                      {recordingState === "recording"
                        ? "Recording in progress. Stop when the voicemail message is complete."
                        : recordingState === "processing"
                          ? "Processing the recorded audio..."
                          : "Keep the recording short and natural so it drops cleanly after the beep, or upload an existing message."}
                    </p>
                    {recordingError ? <p className="error">{recordingError}</p> : null}
                    {voicemailAudioPreviewUrl ? (
                      <audio className="voicemail-recorder__preview" controls src={voicemailAudioPreviewUrl} />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="camp-sms-body">SMS body</label>
            <textarea
              id="camp-sms-body"
              name="smsTemplate"
              required
              maxLength={1600}
              placeholder="Initial broadcast text (include opt-out where required)…"
              value={smsTemplate}
              onChange={(e) => setSmsTemplate(e.target.value)}
            />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <label htmlFor="camp-consent">Consent documentation</label>
          <textarea
            id="camp-consent"
            name="consentNotes"
            required
            placeholder="e.g. web opt-in 2026-04-10; recorded in CRM"
            value={consentNotes}
            onChange={(e) => setConsentNotes(e.target.value)}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <h3 className="section-title" style={{ fontSize: "1rem", marginBottom: 8 }}>
            {kind === "SMS" ? "Contact list (CSV) — required once" : "Optional CSV import"}
          </h3>
          <p className="muted subtle" style={{ marginBottom: 8 }}>
            {kind === "SMS" ? (
              <>
                Upload your list here one time. Needs a <code className="mono">phone</code> column. After create,
                press <strong>Start SMS</strong> on the campaign page — you should not need to upload again.
              </>
            ) : (
              <>
                Requires <code className="mono">phone</code>; imports may continue from the detail view.
              </>
            )}
          </p>
          <label className="file-drop">
            <input
              name="contactsCsv"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              required={kind === "SMS"}
            />
            <span className="file-drop-label">
              {kind === "SMS" ? "Select contact CSV" : "Select CSV or skip"}
            </span>
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="checkbox-row">
            <input
              name="consentAttested"
              type="checkbox"
              checked={consentAttested}
              onChange={(ev) => {
                setConsentAttested(ev.currentTarget.checked);
                if (ev.currentTarget.checked) setErr(null);
              }}
            />
            <span>I attest lawful basis to contact this audience and will honor opt-outs.</span>
          </label>
        </div>
        {err ? <p className="error">{err}</p> : null}
        <div style={{ marginTop: 14 }}>
          <button className="primary glow-hover" type="submit" disabled={submitDisabled}>
            {submitDisabled ? (busy ? "Creating…" : "Finish recording first") : "Create campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
