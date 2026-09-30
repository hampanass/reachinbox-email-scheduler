import { useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import type { Campaign } from "./api";

export type CampaignDraft = {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
};

type Props = {
  onClose: () => void;
  onCreate: (draft: CampaignDraft) => Promise<Campaign>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (character === '"' && csv[index + 1] === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(current.trim());
      current = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = "";
    } else {
      current += character;
    }
  }
  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function parseCsvEmails(csv: string): { recipients: string[]; invalidRows: number } {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return { recipients: [], invalidRows: 0 };

  const headers = rows[0]!.map((cell) => cell.replace(/^\uFEFF/, "").trim().toLowerCase());
  const emailColumn = headers.findIndex((header) => ["email", "e-mail", "email address", "email_address"].includes(header));
  const hasHeader = emailColumn >= 0;
  const columnIndex = hasHeader ? emailColumn : 0;
  const dataRows = rows.slice(hasHeader ? 1 : 0);

  const unique = new Set<string>();
  let invalidRows = 0;
  for (const dataRow of dataRows) {
    const hasContent = dataRow.some((cell) => cell.trim().length > 0);
    if (!hasContent) continue;
    const candidate = (dataRow[columnIndex] ?? "").replace(/^\uFEFF/, "").trim().toLowerCase();
    if (!emailPattern.test(candidate) || unique.has(candidate)) {
      invalidRows += 1;
    } else {
      unique.add(candidate);
    }
  }
  return { recipients: [...unique], invalidRows };
}

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ComposeCampaign({ onClose, onCreate }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [invalidRows, setInvalidRows] = useState(0);
  const [fileName, setFileName] = useState("");
  const [startTime, setStartTime] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 5 * 60_000)),
  );
  const [delaySeconds, setDelaySeconds] = useState("30");
  const [hourlyLimit, setHourlyLimit] = useState("25");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function loadCsv(file?: File) {
    if (!file) return;
    setError("");
    try {
      const parsed = parseCsvEmails(await file.text());
      setRecipients(parsed.recipients);
      setInvalidRows(parsed.invalidRows);
      setFileName(file.name);
      if (parsed.recipients.length === 0) {
        setError("No valid email addresses were found in that CSV.");
        return;
      }
      if (parsed.recipients.length > 1000) {
        setError("A campaign can include up to 1,000 recipients.");
        return;
      }
    } catch {
      setError("We couldn't read that CSV file. Please try another file.");
    }
  }

  function removeCsv() {
    setRecipients([]);
    setInvalidRows(0);
    setFileName("");
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!subject.trim() || !body.trim()) {
      setError("Add a subject and email body before scheduling.");
      return;
    }
    if (recipients.length === 0) {
      setError("Upload a CSV containing at least one valid email address.");
      return;
    }

    const delay = Number(delaySeconds);
    const limit = Number(hourlyLimit);
    const parsedStart = new Date(startTime);
    if (!Number.isFinite(parsedStart.getTime()) || parsedStart.getTime() < Date.now()) {
      setError("Choose a start time in the future.");
      return;
    }
    if (!Number.isInteger(delay) || delay < 0 || !Number.isInteger(limit) || limit < 1) {
      setError("Enter a valid delay and a positive hourly sending limit.");
      return;
    }

    setSubmitting(true);
    try {
      await onCreate({
        subject: subject.trim(),
        body,
        recipients,
        startTime: parsedStart.toISOString(),
        delayBetweenEmails: delay * 1_000,
        hourlyLimit: limit,
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Campaign could not be scheduled.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header className="compose-header">
          <div>
            <p className="overline">NEW CAMPAIGN</p>
            <h2 id="compose-title">Compose email</h2>
            <p>Build your message and choose when it should go out.</p>
          </div>
          <button className="icon-button muted-button" aria-label="Close composer" onClick={onClose}><Icon name="close" /></button>
        </header>

        <form onSubmit={handleSubmit} className="compose-form">
          <label className="field-label" htmlFor="campaign-subject">Subject</label>
          <input id="campaign-subject" className="text-input" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={998} placeholder="A clear, thoughtful subject" required />

          <div className="field-label-row"><label className="field-label" htmlFor="campaign-body">Email body</label><span>Plain text</span></div>
          <textarea id="campaign-body" className="text-input body-input" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your message here…" required />

          <div className="field-label-row"><span className="field-label">Recipients</span><span>CSV · up to 1,000</span></div>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(event) => void loadCsv(event.target.files?.[0])} />
          <div className={`upload-zone ${recipients.length ? "upload-zone-ready" : ""}`}>
            <span className="upload-icon"><Icon name={recipients.length ? "check" : "upload"} /></span>
            <span className="upload-copy"><strong>{fileName || "Upload CSV"}</strong><small>{fileName ? `${recipients.length} valid recipients · ${invalidRows} invalid rows` : "CSV with an email column · up to 1,000 recipients"}</small></span>
            <button type="button" className="browse-label" onClick={() => fileInput.current?.click()}>{fileName ? "Replace" : "Upload CSV"}</button>
            {fileName && <button type="button" className="remove-csv" aria-label="Remove CSV" title="Remove CSV" onClick={removeCsv}><Icon name="close" size={15} /></button>}
          </div>
          {recipients.length > 0 && <div className="recipient-preview">{recipients.slice(0, 4).map((email) => <span key={email}>{email}</span>)}{recipients.length > 4 && <span>+{recipients.length - 4} more</span>}</div>}

          <div className="schedule-section">
            <div className="schedule-title"><span className="schedule-icon"><Icon name="calendar" size={16} /></span><div><strong>Delivery schedule</strong><small>Control timing and sending pace</small></div></div>
            <div className="schedule-fields">
              <label>Start date &amp; time<input className="text-input" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
              <label>Delay between emails <span className="input-unit"><input className="text-input" type="number" min="0" step="1" value={delaySeconds} onChange={(event) => setDelaySeconds(event.target.value)} required /><small>sec</small></span></label>
              <label>Hourly sending limit <span className="input-unit"><input className="text-input" type="number" min="1" step="1" value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} required /><small>emails / hour</small></span></label>
            </div>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}
          <footer className="compose-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? <span className="button-spinner" /> : <Icon name="send" size={16} />}
              {submitting ? "Scheduling…" : "Schedule campaign"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
