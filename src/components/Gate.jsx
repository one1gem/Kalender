import React, { useState, useRef, useEffect } from "react";
import { styles } from "../styles.js";
import { supabase } from "../lib/supabaseClient.js";

function getDeviceId() {
  let id = localStorage.getItem("tk_device");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("tk_device", id);
  }
  return id;
}

export function loadToken() {
  return localStorage.getItem("tk_token") || null;
}

function saveToken(token) {
  localStorage.setItem("tk_token", token);
}

export function clearToken() {
  localStorage.removeItem("tk_token");
}

export async function validateToken(token) {
  if (!token) return false;
  try {
    const { data, error } = await supabase.rpc("check_session", { p_token: token });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export async function logout(token) {
  clearToken();
  if (!token) return;
  try {
    await supabase.rpc("end_session", { p_token: token });
  } catch {
    // Token ist lokal weg
  }
}

export default function Gate({ onDone }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const inputs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setInterval(() => setLockSeconds((s) => (s > 1 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [lockSeconds > 0]);

  const submit = async (pin) => {
    setBusy(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("verify_pin", {
        p_pin: pin,
        p_device: getDeviceId(),
      });
      if (rpcError) throw rpcError;
      if (data?.ok) {
        saveToken(data.token);
        onDone(data.token);
        return;
      }
      setDigits(["", "", "", ""]);
      inputs[0].current?.focus();
      if (data?.locked) {
        setLockSeconds(Number(data.retry_seconds) || 300);
      } else {
        const remaining = data?.remaining;
        setError(
          remaining != null && remaining > 0
            ? `Falscher PIN. Noch ${remaining} Versuch${remaining === 1 ? "" : "e"}.`
            : "Falscher PIN."
        );
      }
    } catch (e) {
      console.error(e);
      setError("Verbindung fehlgeschlagen. Bitte Internet prüfen und erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (idx, val) => {
    const clean = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    if (clean && idx < 3) inputs[idx + 1].current?.focus();
    if (clean && idx === 3) {
      const pin = next.join("");
      if (pin.length === 4) submit(pin);
    }
  };

  const onKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs[idx - 1].current?.focus();
    }
  };

  const locked = lockSeconds > 0;
  const mins = Math.floor(lockSeconds / 60);
  const secs = lockSeconds % 60;

  return (
    <div style={styles.gateShell}>
      <div style={styles.gateCard}>
        <div style={styles.gateMark}>TK</div>
        <div style={styles.gateTitle}>Team &amp; Kalender</div>
        <div style={styles.gateSub}>
          {locked
            ? `Zu viele Fehlversuche. Bitte warten: ${mins}:${String(secs).padStart(2, "0")}`
            : "4-stelligen PIN eingeben."}
        </div>
        {error && !locked && <div style={styles.gateError}>{error}</div>}
        <div style={styles.pinRow}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={inputs[i]}
              style={styles.pinBox}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              maxLength={1}
              disabled={busy || locked}
              autoFocus={i === 0}
              aria-label={`PIN Ziffer ${i + 1}`}
            />
          ))}
        </div>
        {busy && <div style={styles.gateSub}>Prüfe…</div>}
      </div>
    </div>
  );
}
