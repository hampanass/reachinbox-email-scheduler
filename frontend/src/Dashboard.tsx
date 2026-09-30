import { useEffect, useMemo, useState } from "react";
import { api, type Campaign, type CampaignEmail, type EmailDetail, type EmailStatus, type SearchEmail, type SessionUser } from "./api";
import { ComposeCampaign, type CampaignDraft } from "./ComposeCampaign";
import { Icon } from "./Icon";

type Props = { user: SessionUser; onLogout: () => Promise<void> };
type Tab = "scheduled" | "sent";
type EmailRow = {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
};

function flattenCampaigns(campaigns: Campaign[]): EmailRow[] {
  return campaigns.flatMap((campaign) => campaign.emails.map((email: CampaignEmail) => ({
    id: email.id,
    campaignId: campaign.id,
    recipient: email.recipientEmail,
    subject: campaign.subject,
    body: campaign.body,
    status: email.status,
    scheduledAt: email.scheduledAt,
    sentAt: email.sentAt,
  })));
}

function formatDate(value: string | null, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", ...options,
  }).format(date);
}

function initials(user: SessionUser) {
  const value = user.name?.trim() || user.email;
  return value.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function StatusPill({ status }: { status: EmailStatus }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`status-pill status-${status.toLowerCase()}`}><i />{label}</span>;
}

function LoadingRows() {
  return <div className="loading-rows" aria-label="Loading emails">{[0, 1, 2, 3].map((item) => <div className="loading-row" key={item}><i /><span /><span /><b /></div>)}</div>;
}

export function Dashboard({ user, onLogout }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [campaignError, setCampaignError] = useState("");
  const [tab, setTab] = useState<Tab>("scheduled");
  const [search, setSearch] = useState("");
  const [searchRows, setSearchRows] = useState<SearchEmail[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<EmailRow | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState("");

  async function loadCampaigns() {
    setRowsLoading(true);
    setCampaignError("");
    try {
      setCampaigns(await api.campaigns());
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Campaigns could not be loaded.");
    } finally {
      setRowsLoading(false);
    }
  }

  useEffect(() => { void loadCampaigns(); }, []);

  useEffect(() => {
    if (!selected) {
      setSelectedDetail(null);
      setDetailError("");
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    setSelectedDetail(null);
    api.email(selected.id).then((detail) => {
      if (!cancelled) setSelectedDetail(detail);
    }).catch((error: unknown) => {
      if (!cancelled) setDetailError(error instanceof Error ? error.message : "Email details could not be loaded.");
    }).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });
    return () => { cancelled = true; };
  }, [selected?.id, detailRetry]);

  useEffect(() => {
    const normalized = search.trim();
    if (!normalized) {
      setSearchRows(null);
      setSearchError("");
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const result = await api.searchEmails(normalized);
        if (!cancelled) setSearchRows(result.results);
      } catch (error) {
        if (!cancelled) {
          setSearchRows([]);
          setSearchError(error instanceof Error ? error.message : "Search is temporarily unavailable.");
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, searchVersion]);

  const campaignRows = useMemo(() => flattenCampaigns(campaigns), [campaigns]);
  const visibleRows = useMemo(() => {
    const source: EmailRow[] = searchRows === null
      ? campaignRows
      : searchRows.map((result) => ({
          id: result.emailId,
          campaignId: result.campaignId,
          recipient: result.recipient,
          subject: result.subject,
          body: result.body,
          status: result.status,
          scheduledAt: result.scheduledAt,
          sentAt: result.sentAt,
        }));
    return source
      .filter((row) => tab === "sent" ? row.status === "SENT" : row.status !== "SENT")
      .sort((a, b) => new Date(tab === "sent" ? b.sentAt ?? b.scheduledAt : a.scheduledAt).getTime() - new Date(tab === "sent" ? a.sentAt ?? a.scheduledAt : b.scheduledAt).getTime());
  }, [campaignRows, searchRows, tab]);

  const sentCount = campaignRows.filter((row) => row.status === "SENT").length;
  const scheduledCount = campaignRows.filter((row) => row.status !== "SENT").length;

  async function createCampaign(draft: CampaignDraft) {
    const created = await api.createCampaign(draft);
    setComposeOpen(false);
    setTab("scheduled");
    setSearch("");
    setSelected(null);
    setToast("Your campaign is scheduled.");
    window.setTimeout(() => setToast(""), 3600);
    await loadCampaigns();
    return created;
  }

  async function logout() {
    setLogoutBusy(true);
    try {
      await onLogout();
    } finally {
      setLogoutBusy(false);
    }
  }

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><span className="brand-glyph"><Icon name="mail" size={19} /></span><span>reachinbox<span className="brand-period">.</span></span></div>
        <button className="compose-nav-button" onClick={() => { setComposeOpen(true); setMobileNavOpen(false); }}><Icon name="plus" size={17} /> Compose email</button>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="main-nav" aria-label="Email views">
          <button className={`nav-link ${tab === "scheduled" ? "nav-link-active" : ""}`} onClick={() => { setTab("scheduled"); setMobileNavOpen(false); }}><Icon name="clock" /><span>Scheduled</span><span className="nav-count">{scheduledCount}</span></button>
          <button className={`nav-link ${tab === "sent" ? "nav-link-active" : ""}`} onClick={() => { setTab("sent"); setMobileNavOpen(false); }}><Icon name="send" /><span>Sent</span><span className="nav-count">{sentCount}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note"><span className="workspace-avatar"><Icon name="spark" size={16} /></span><div><strong>Your workspace</strong><small>Outreach, in one place</small></div></div>
          <button className="account-button" onClick={() => void logout()} disabled={logoutBusy}>
            <span className="avatar">{initials(user)}</span><span className="account-text"><strong>{user.name || user.email.split("@")[0]}</strong><small>{user.email}</small></span><Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><span /><span /><span /></button>
          <div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={14} /><strong>{tab === "scheduled" ? "Scheduled" : "Sent"}</strong></div>
          <label className="global-search"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search emails, recipients…" aria-label="Search emails" /><kbd>⌘ K</kbd></label>
          <button className="top-user" onClick={() => void logout()} title="Sign out"><span className="avatar avatar-small">{initials(user)}</span><Icon name="chevron" size={15} /></button>
        </header>

        <div className={`content-wrap ${selected ? "content-with-detail" : ""}`}>
          <section className="dashboard-content">
            <div className="welcome-line"><div><p className="overline">YOUR OUTREACH OVERVIEW</p><h1>{tab === "scheduled" ? "Campaigns, on schedule." : "Your messages, delivered."}</h1><p className="page-description">{tab === "scheduled" ? "Keep an eye on what’s going out next." : "A clear view of everything you’ve sent."}</p></div><button className="primary-button desktop-compose" onClick={() => setComposeOpen(true)}><Icon name="plus" size={17} /> New campaign</button></div>

            <div className="metric-grid">
              <article className="metric-card"><span className="metric-icon metric-icon-blue"><Icon name="clock" /></span><span className="metric-label">Scheduled emails</span><strong>{rowsLoading ? "—" : scheduledCount.toLocaleString()}</strong><small>Across all campaigns</small></article>
              <article className="metric-card"><span className="metric-icon metric-icon-green"><Icon name="send" /></span><span className="metric-label">Emails sent</span><strong>{rowsLoading ? "—" : sentCount.toLocaleString()}</strong><small>Successfully delivered</small></article>
              <article className="metric-card metric-note"><span className="metric-icon metric-icon-purple"><Icon name="spark" /></span><span className="metric-label">A little more focus</span><strong>Good outreach<br />takes timing.</strong><small>Your schedule handles the rest.</small></article>
            </div>

            <section className="email-section">
              <div className="list-heading"><div><h2>{tab === "scheduled" ? "Scheduled emails" : "Sent emails"}</h2><p>{search.trim() ? `Results matching “${search.trim()}”` : tab === "scheduled" ? "Your upcoming messages, all in one view." : "Messages that have made it to their recipients."}</p></div><button className="icon-button refresh-button" onClick={() => void loadCampaigns()} aria-label="Refresh campaigns" title="Refresh"><Icon name="refresh" size={17} /></button></div>
              <div className="tab-row"><button className={tab === "scheduled" ? "tab-active" : ""} onClick={() => { setTab("scheduled"); setSelected(null); }}><Icon name="clock" size={15} /> Scheduled <span>{scheduledCount}</span></button><button className={tab === "sent" ? "tab-active" : ""} onClick={() => { setTab("sent"); setSelected(null); }}><Icon name="send" size={15} /> Sent <span>{sentCount}</span></button></div>

              {(campaignError || searchError) && <div className="error-banner" role="alert"><span>{searchError || campaignError}</span><button onClick={() => search.trim() ? setSearchVersion((value) => value + 1) : void loadCampaigns()}>Try again</button></div>}
              {rowsLoading && !search.trim() ? <LoadingRows /> : searchLoading ? <LoadingRows /> : visibleRows.length === 0 ? (
                <div className="empty-state"><span className="empty-icon"><Icon name={search.trim() ? "search" : tab === "sent" ? "send" : "inbox"} size={24} /></span><h3>{search.trim() ? "No matching emails" : tab === "sent" ? "Nothing sent yet" : "Your schedule is clear"}</h3><p>{search.trim() ? "Try another recipient, subject, or phrase from the email body." : tab === "sent" ? "Sent messages will appear here once a campaign is delivered." : "Create a campaign and your upcoming emails will appear here."}</p>{!search.trim() && tab === "scheduled" && <button className="secondary-button" onClick={() => setComposeOpen(true)}><Icon name="plus" size={16} /> Create your first campaign</button>}</div>
              ) : (
                <div className="email-table-wrap"><table className="email-table"><thead><tr><th>RECIPIENT</th><th>SUBJECT / CAMPAIGN</th><th>{tab === "sent" ? "SENT AT" : "SCHEDULED FOR"}</th><th>STATUS</th><th /></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id} className={selected?.id === row.id ? "row-selected" : ""} onClick={() => setSelected(row)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setSelected(row)}><td><div className="recipient-cell"><span className="recipient-avatar">{row.recipient.slice(0, 1).toUpperCase()}</span><span>{row.recipient}</span></div></td><td><div className="subject-cell"><strong>{row.subject || "(no subject)"}</strong><small>{row.campaignId.slice(0, 12)}…</small></div></td><td><span className="date-cell">{formatDate(tab === "sent" ? row.sentAt : row.scheduledAt, { year: undefined })}</span></td><td><StatusPill status={row.status} /></td><td><Icon name="chevron" size={16} className="row-chevron" /></td></tr>)}</tbody></table></div>
              )}
              {!rowsLoading && !searchLoading && visibleRows.length > 0 && <p className="list-footnote">Showing {visibleRows.length} {visibleRows.length === 1 ? "email" : "emails"}</p>}
            </section>
          </section>

          {selected && <aside className="detail-panel" aria-label="Email details"><div className="detail-top"><span className="overline">EMAIL DETAILS</span><button className="icon-button muted-button" onClick={() => setSelected(null)} aria-label="Close details"><Icon name="close" size={18} /></button></div>{detailLoading ? <div className="detail-loading"><span className="button-spinner" />Loading email details…</div> : detailError ? <div className="detail-load-error" role="alert">{detailError}<button className="secondary-button" onClick={() => setDetailRetry((value) => value + 1)}>Try again</button></div> : selectedDetail && <><div className="detail-icon"><Icon name="mail" size={20} /></div><h2>{selectedDetail.subject || "(no subject)"}</h2><StatusPill status={selectedDetail.status} /><div className="detail-fields"><div><span>TO</span><strong>{selectedDetail.recipient}</strong></div><div><span>CAMPAIGN</span><strong>{selectedDetail.campaign.name}</strong></div><div><span>CAMPAIGN ID</span><strong className="mono-text">{selectedDetail.campaign.id}</strong></div><div><span>SCHEDULED FOR</span><strong>{formatDate(selectedDetail.scheduledAt)}</strong></div><div><span>SENT AT</span><strong>{formatDate(selectedDetail.sentAt)}</strong></div></div><div className="detail-message"><span>FULL MESSAGE</span><p>{selectedDetail.body}</p></div><div className="detail-footer"><span className="detail-footer-dot" /> Loaded from your campaign</div></>}</aside>}
        </div>
      </main>

      <button className="mobile-compose primary-button" onClick={() => setComposeOpen(true)} aria-label="Compose campaign"><Icon name="plus" size={20} /></button>
      {composeOpen && <ComposeCampaign onClose={() => setComposeOpen(false)} onCreate={createCampaign} />}
      {toast && <div className="toast"><span><Icon name="check" size={16} /></span>{toast}</div>}
    </div>
  );
}
