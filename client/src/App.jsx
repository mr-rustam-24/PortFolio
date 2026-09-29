import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useParams } from "react-router-dom";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

function api(path, options = {}) {
  const cleanPath = String(path).replace(/^\/+/, "");

  return fetch(`${API_URL}/api/${cleanPath}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  }).then(async (response) => {
    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Server ne invalid response diya (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  });
}

function assetUrl(path) {
  if (!path) return "";
  const value = String(path);
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return `${API_URL}/${value.replace(/^\/+/, "")}`;
}

const NAMES = [
  "profile",
  "menu",
  "skills",
  "projects",
  "experience",
  "certificates",
];

const UP = ["photo", "resume", "image"];

export default function App() {
  const [d, setD] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [dark, setDark] = useState(localStorage.getItem("theme") !== "light");

  const load = () =>
    Promise.all(NAMES.map((name) => api(name)))
      .then((results) => {
        setD(
          Object.fromEntries(NAMES.map((name, i) => [name, results[i]])),
        );
        setLoadError("");
      })
      .catch((error) => {
        setLoadError(error.message || "Portfolio data load nahi ho saka.");
      });

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  if (!d) {
    return (
      <div className="boot">
        {loadError ? (
          <>
            <p>{loadError}</p>
            <button className="cta" onClick={load}>
              Retry
            </button>
          </>
        ) : (
          "Loading…"
        )}
      </div>
    );
  }

  const menu = d.menu
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order);

  const p = d.profile;

  return (
    <div className="app">
      <aside className="side">
        <div className="who">
          {p.photo && <img src={assetUrl(p.photo)} alt={p.name} />}
          <h1>{p.name}</h1>
          <p>{p.role}</p>
        </div>

        <nav>
          {menu.map((item) => (
            <NavLink key={item.id} to={"/" + item.id} className="btn">
              <span>{item.icon}</span>
              {item.title}
            </NavLink>
          ))}
        </nav>

        <div className="foot">
          {p.github && (
            <a href={p.github} target="_blank" rel="noreferrer">
              GitHub
            </a>
          )}
          {p.linkedin && (
            <a href={p.linkedin} target="_blank" rel="noreferrer">
              LinkedIn
            </a>
          )}
          <button className="tog" onClick={() => setDark(!dark)}>
            {dark ? "Light" : "Dark"} mode
          </button>
          <NavLink to="/admin" aria-label="Admin login">
            🔒
          </NavLink>
        </div>
      </aside>

      <div className="rule" />

      <main className="panel">
        <Routes>
          <Route
            path="/"
            element={<Navigate to={"/" + (menu[0]?.id || "about")} replace />}
          />
          <Route path="/admin" element={<Admin reload={load} />} />
          <Route path="/:id" element={<Panel d={d} menu={menu} />} />
        </Routes>
      </main>
    </div>
  );
}

function Panel({ d, menu }) {
  const { id } = useParams();
  const item = menu.find((m) => m.id === id);
  if (!item) return <Navigate to="/" replace />;

  const T = {
    about: About,
    skills: Skills,
    projects: Projects,
    experience: Experience,
    certificates: Certs,
    contact: Contact,
  }[item.contentType];

  return (
    <section className="sec" key={id}>
      <h2>{item.title}</h2>
      {T ? <T d={d} /> : <p className="sub">Nothing here yet.</p>}
    </section>
  );
}

const Empty = ({ t = "Nothing here yet." }) => <p className="sub">{t}</p>;

function About({ d: { profile: p } }) {
  return (
    <>
      <p className="sub">{p.tagline}</p>
      <p style={{ maxWidth: "62ch" }}>{p.bio}</p>

      {p.learning?.length > 0 && (
        <>
          <h3>Currently learning</h3>
          {p.learning.map((l) => (
            <span className="chip" key={l}>
              {l}
            </span>
          ))}
        </>
      )}

      <div style={{ marginTop: 24 }}>
        {p.resume && (
          <a className="cta" href={assetUrl(p.resume)} download>
            Download resume
          </a>
        )}
        <NavLink className="cta alt" to="/contact">
          Hire me
        </NavLink>
      </div>
    </>
  );
}

function Skills({ d: { skills } }) {
  if (!skills.length) return <Empty t="No skills added yet." />;

  const cats = [...new Set(skills.map((s) => s.category || "Other"))];

  return cats.map((c) => (
    <div key={c} style={{ marginBottom: 28 }}>
      <h3>{c}</h3>
      <div className="grid">
        {skills
          .filter((s) => (s.category || "Other") === c)
          .map((s) => (
            <div className="card" key={s.name}>
              <b>{s.name}</b>{" "}
              <span className="chip" style={{ float: "right" }}>
                {s.level}%
              </span>
              <div
                className="bar"
                style={{ marginTop: 10 }}
                role="progressbar"
                aria-valuenow={s.level}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: s.level + "%" }} />
              </div>
            </div>
          ))}
      </div>
    </div>
  ));
}

function Modal({ onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="card box"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="cta alt" onClick={onClose}>
          Close
        </button>
        {children}
      </div>
    </div>
  );
}

function Projects({ d: { projects = [] } }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  const list = projects.filter((p) =>
    (p.title + " " + p.description + " " + (p.tech || []).join(" "))
      .toLowerCase()
      .includes(q.toLowerCase()),
  );

  const Links = ({ p }) => (
    <>
      {p.live && (
        <a className="cta" href={p.live} target="_blank" rel="noreferrer">
          Live
        </a>
      )}
      {p.github && (
        <a className="cta alt" href={p.github} target="_blank" rel="noreferrer">
          Code
        </a>
      )}
    </>
  );

  return (
    <>
      <input
        placeholder="Search by name or technology"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search projects"
        style={{ maxWidth: 360 }}
      />

      {!list.length ? (
        <Empty t="No projects match your search." />
      ) : (
        <div className="grid">
          {list.map((p) => (
            <article className="card" key={p.title}>
              {p.image && (
                <img
                  className="thumb"
                  src={assetUrl(p.image)}
                  alt={p.title}
                  loading="lazy"
                />
              )}
              <h3 style={{ margin: 0 }}>{p.title}</h3>
              <p>{p.description}</p>
              <div>
                {(p.tech || []).map((t) => (
                  <span className="chip" key={t}>
                    {t}
                  </span>
                ))}
              </div>
              <button className="cta" onClick={() => setOpen(p)}>
                Details
              </button>
              <Links p={p} />
            </article>
          ))}
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(null)}>
          {open.image && (
            <img className="thumb" src={assetUrl(open.image)} alt={open.title} />
          )}
          <h3>{open.title}</h3>
          <p>{open.description}</p>
          <p style={{ whiteSpace: "pre-line" }}>{open.details}</p>
          <div>
            {(open.tech || []).map((t) => (
              <span className="chip" key={t}>
                {t}
              </span>
            ))}
          </div>
          <Links p={open} />
        </Modal>
      )}
    </>
  );
}

function Certs({ d: { certificates = [] } }) {
  const [open, setOpen] = useState(null);

  if (!certificates.length) return <Empty t="No certificates added yet." />;

  return (
    <>
      <div className="grid">
        {certificates.map((c) => (
          <article className="card" key={c.title}>
            {c.image && (
              <img
                className="thumb"
                src={assetUrl(c.image)}
                alt={c.title}
                loading="lazy"
              />
            )}
            <b>{c.title}</b>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {c.issuer} {c.year && "· " + c.year}
            </p>
            {c.image && (
              <button
                className="cta alt"
                style={{ marginTop: 12 }}
                onClick={() => setOpen(c)}
              >
                Preview
              </button>
            )}
            {c.link && (
              <a className="cta" href={c.link} target="_blank" rel="noreferrer">
                Verify
              </a>
            )}
          </article>
        ))}
      </div>

      {open && (
        <Modal onClose={() => setOpen(null)}>
          <img
            style={{ width: "100%", borderRadius: 12 }}
            src={assetUrl(open.image)}
            alt={open.title}
          />
        </Modal>
      )}
    </>
  );
}

function Experience({ d: { experience = [] } }) {
  if (!experience.length) return <Empty t="No experience added yet." />;

  return (
    <div className="tl">
      {experience.map((e, i) => (
        <div key={i}>
          <b>{e.role}</b>, {e.company}
          <br />
          <small style={{ color: "var(--muted)" }}>{e.period}</small>
          <p>{e.details}</p>
        </div>
      ))}
    </div>
  );
}

function Contact({ d: { profile: p = {} } }) {
  const [f, setF] = useState({ name: "", email: "", message: "" });
  const [s, setS] = useState("");
  const [sending, setSending] = useState(false);

  const send = (e) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setS("Sending…");

    api("contact", { method: "POST", body: JSON.stringify(f) })
      .then(() => {
        setS("Message sent. Thank you!");
        setF({ name: "", email: "", message: "" });
      })
      .catch((x) => setS(x.message || "Unable to send message."))
      .finally(() => setSending(false));
  };

  return (
    <>
      <p className="sub">
        Reach me at{" "}
        {p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : "my email"} or
        send a message below.
      </p>

      <form className="form" onSubmit={send}>
        <label>
          Name
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            required
          />
        </label>
        <label>
          Message
          <textarea
            rows="5"
            value={f.message}
            onChange={(e) => setF({ ...f, message: e.target.value })}
            required
          />
        </label>
        <button className="cta" disabled={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>{" "}
        <span className="msg" role="status">
          {s}
        </span>
      </form>
    </>
  );
}

/* ---------- Admin ---------- */
const SCHEMA = {
  profile: {
    single: true,
    fields: [
      "name",
      "role",
      "tagline",
      "bio",
      "photo",
      "resume",
      "email",
      "github",
      "linkedin",
      "learning",
    ],
  },
  skills: {
    fields: ["name", "category", "level"],
    blank: { name: "", category: "", level: 50 },
  },
  projects: {
    fields: ["title", "description", "details", "image", "tech", "live", "github"],
    blank: {
      title: "",
      description: "",
      details: "",
      image: "",
      tech: [],
      live: "",
      github: "",
    },
  },
  certificates: {
    fields: ["title", "issuer", "year", "image", "link"],
    blank: { title: "", issuer: "", year: "", image: "", link: "" },
  },
  experience: {
    fields: ["role", "company", "period", "details"],
    blank: { role: "", company: "", period: "", details: "" },
  },
  menu: {
    fields: ["id", "title", "icon", "order", "visible", "contentType"],
    blank: {
      id: "",
      title: "",
      icon: "⭐",
      order: 9,
      visible: true,
      contentType: "about",
    },
  },
};

function Admin({ reload }) {
  const [ok, setOk] = useState(null);

  useEffect(() => {
    api("me")
      .then(() => setOk(true))
      .catch(() => setOk(false));
  }, []);

  if (ok === null) return null;

  return ok ? (
    <Dash
      reload={reload}
      out={() => api("logout", { method: "POST" }).then(() => setOk(false))}
    />
  ) : (
    <Login done={() => setOk(true)} />
  );
}

function Login({ done }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  return (
    <section className="sec">
      <h2>Admin</h2>
      <p className="sub">Enter your password to edit your portfolio.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setErr("");
          api("login", {
            method: "POST",
            body: JSON.stringify({ password: pw }),
          })
            .then(done)
            .catch((x) => setErr(x.message));
        }}
      >
        <label>
          Password
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
        </label>
        <button className="cta">Log in</button>{" "}
        <span className="msg" role="alert">
          {err}
        </span>
      </form>
    </section>
  );
}

function Dash({ reload, out }) {
  const [tab, setTab] = useState("profile");

  return (
    <section className="sec">
      <h2>Admin</h2>
      <div className="tabs">
        {[...Object.keys(SCHEMA), "messages"].map((t) => (
          <button
            key={t}
            className={"cta" + (tab === t ? "" : " alt")}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <button className="cta alt" onClick={out}>
          Log out
        </button>
      </div>

      {tab === "messages" ? (
        <Inbox />
      ) : (
        <Editor key={tab} name={tab} reload={reload} />
      )}
    </section>
  );
}

function Editor({ name, reload }) {
  const S = SCHEMA[name];
  const [v, setV] = useState(null);
  const [msg, setMsg] = useState("");
  const [ver, setVer] = useState(0);

  useEffect(() => {
    api(name)
      .then(setV)
      .catch((e) => setMsg(e.message));
  }, [name]);

  if (!v) return msg ? <p className="msg">{msg}</p> : null;

  const rows = S.single ? [v] : v;

  const conv = (o, s) =>
    Array.isArray(o)
      ? s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : typeof o === "number"
        ? Number(s)
        : typeof o === "boolean"
          ? s === "true"
          : s;

  const set = (i, k, s) =>
    setV(
      S.single
        ? { ...v, [k]: conv(v[k], s) }
        : v.map((r, j) => (j === i ? { ...r, [k]: conv(r[k], s) } : r)),
    );

  const save = () =>
    api(name, { method: "PUT", body: JSON.stringify(v) })
      .then(() => {
        setMsg("Saved");
        reload();
      })
      .catch((e) => setMsg(e.message));

  const up = (f, i, k) => {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);

    api("upload", { method: "POST", body: fd })
      .then((j) => {
        set(i, k, j.url);
        setVer((x) => x + 1);
        setMsg("Uploaded. Click Save changes.");
      })
      .catch((e) => setMsg(e.message));
  };

  return (
    <>
      {rows.map((r, i) => (
        <div className="card" key={ver + "-" + i} style={{ marginBottom: 14 }}>
          <div className="row">
            {S.fields.map((k) => (
              <label key={k}>
                {k}
                <input
                  defaultValue={
                    Array.isArray(r[k]) ? r[k].join(", ") : String(r[k] ?? "")
                  }
                  onBlur={(e) => set(i, k, e.target.value)}
                />
                {UP.includes(k) && (
                  <input
                    type="file"
                    accept={k === "resume" ? "application/pdf" : "image/*"}
                    onChange={(e) => up(e.target.files[0], i, k)}
                  />
                )}
              </label>
            ))}
          </div>

          {!S.single && (
            <button
              className="cta alt"
              onClick={() => {
                if (window.confirm("Delete this item?")) {
                  setV(v.filter((_, j) => j !== i));
                  setVer(ver + 1);
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      ))}

      {!S.single && (
        <button
          className="cta alt"
          onClick={() => {
            setV([...v, { ...S.blank }]);
            setVer(ver + 1);
          }}
        >
          Add new
        </button>
      )}

      <button className="cta" onClick={save}>
        Save changes
      </button>{" "}
      <span className="msg" role="status">
        {msg}
      </span>
    </>
  );
}

function Inbox() {
  const [m, setM] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("messages")
      .then(setM)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="msg">{err}</p>;
  if (!m) return null;
  if (!m.length) return <Empty t="No messages yet." />;

  return m.map((x) => (
    <div className="card" key={x.id} style={{ marginBottom: 14 }}>
      <b>{x.name}</b> ({x.email})<br />
      <small>{new Date(x.date).toLocaleString()}</small>
      <p>{x.message}</p>
      <button
        className="cta alt"
        onClick={() =>
          api("messages/" + x.id, { method: "DELETE" })
            .then(() => setM(m.filter((y) => y.id !== x.id)))
            .catch((e) => setErr(e.message))
        }
      >
        Delete
      </button>
    </div>
  ));
}