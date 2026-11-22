/* dnx_funkgeraete.js   v8.24   2026-11-22
   ---------------------------------------------------------------------------
   DREI FUNKGERAETE - am Empfaenger verdrahtet (Live-2D/3D-Wasserfall & S-Meter)

     Geraet 1 : Funkgeraet 1 - 3DSS-Konsole   (dunkles Pult, beleuchtetes TFT,
                S-Meter-Bogen mit Hintergrundlicht, Live-2D/3D-Wasserfall,
                echt hinterleuchtete Tasten mit COLOR-Wahl)
     Geraet 2 : Funkgeraet 2 - Klassik-Konsole (beleuchtetes Analog-S-Meter,
                Live-Bandscope & Wasserfall, F1-F7, Direkteingabe, VFO-Rad,
                SQ-/RF-Gain-Drehregler)
     Geraet 3 : Funkgeraet 3 - Touch-Konsole  (Balken-S-Meter, Spektrumscope
                & Wasserfall, Dual-Drehregler, VFO-Rad & Softkeys)

   Alle drei zeigen auf denselben Empfaenger (ohne Marken-/Modellnamen auf der Front).
   Laden: dnx_styler.js laedt diese Datei am Ende nach.
   Test:  window.dnxFunkgeraete.stand()
   --------------------------------------------------------------------------- */
(function () {
  "use strict";
  if (window.__dnxFunkgeraete) { return; }
  window.__dnxFunkgeraete = true;

  var FASSUNG = "v8.24";
  /* Neuer Schluessel, weil die alten Startwerte (14,195/7,035 MHz) sonst aus
     dem Speicher zurueckkommen und wieder ausserhalb des Fensters liegen. */
  var LS = "dnx.fg.zustand3";
  var SPERREN = true;

  /* ================= gemeinsame Daten ================================== */
  var BAENDER = [
    { n: "2200 m", hz: 136750 }, { n: "630 m", hz: 475500 }, { n: "160 m", hz: 1.905e6 },
    { n: "80 m", hz: 3.65e6 },   { n: "60 m", hz: 5.359e6 }, { n: "40 m", hz: 7.1e6 },
    { n: "30 m", hz: 10.125e6 }, { n: "20 m", hz: 14.175e6 }, { n: "17 m", hz: 18.118e6 },
    { n: "15 m", hz: 21.225e6 }, { n: "12 m", hz: 24.94e6 },  { n: "10 m", hz: 28.85e6 },
    { n: "6 m", hz: 51.0e6 },    { n: "4 m", hz: 70.175e6 },  { n: "2 m", hz: 145.0e6 },
    { n: "70 cm", hz: 432.5e6 }, { n: "23 cm", hz: 1296.5e6 }, { n: "ULF", hz: 75000 }
  ];
  var HAM_LEISTE_BAENDER = [
    "160 m", "80 m", "60 m", "40 m", "30 m", "20 m", "17 m", "15 m",
    "12 m", "10 m", "6 m", "4 m", "2 m", "70 cm", "23 cm"
  ];
  var MODI = ["LSB", "USB", "CW", "AM", "FM", "WFM", "DATA"];
  var SPEICHER = [
    { n: "Notruf 2 m", hz: 145.5e6, m: "FM" },
    { n: "Rundruf 80 m", hz: 3.643e6, m: "LSB" },
    { n: "QSO 40 m", hz: 7.035e6, m: "CW" },
    { n: "DX 20 m", hz: 14.195e6, m: "USB" },
    { n: "Relais DB0", hz: 438.8e6, m: "FM" },
    { n: "6 m Anruf", hz: 50.15e6, m: "USB" }
  ];
  var SCHRITTE = [10, 100, 1000, 5000, 12500, 25000];

  /* ================= kleine Helfer ===================================== */
  function hzText(hz) {
    var s = String(Math.round(hz));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  function hzKurz(hz) {
    return (hz / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }
  function schrittText(s) {
    if (s >= 1000) { return (s / 1000).toLocaleString("de-DE") + " kHz"; }
    return s + " Hz";
  }
  function eingabeHz(text) {
    if (!text) { return null; }
    var clean = String(text).trim().replace(",", ".");
    if (clean.indexOf(".") >= 0) {
      var mhz = parseFloat(clean);
      if (!isFinite(mhz) || mhz <= 0) { return null; }
      return Math.round(mhz * 1e6);
    }
    var n = parseInt(clean, 10);
    if (!isFinite(n) || n <= 0) { return null; }
    return (clean.length <= 7) ? n * 1000 : n;
  }
  function bandVon(hz) {
    var best = null, dist = Infinity;
    for (var i = 0; i < BAENDER.length; i++) {
      var d = Math.abs(Math.log(hz / BAENDER[i].hz));
      if (d < dist) { dist = d; best = BAENDER[i]; }
    }
    return best;
  }
  function modusKlein(m) { return String(m || "").toLowerCase(); }

  /* ================= Empfaenger ======================================== */
  /* [ECHTE ABSTIMMUNG] 20.11.2026
     Getestet auf 113: UI.setFrequency() wirkt NUR innerhalb des aktuellen
     Empfangsfensters. Liegt die Frequenz ausserhalb, tut die Funktion stumm
     gar nichts - keine Meldung, keine Aenderung. Genau daran hing die
     "Verknuepfung stimmt nicht": das Profil wurde umgeschaltet, die Frequenz
     blieb aber auf 31 MHz stehen.
     Deshalb hier zwei getrennte Wege:
       - im Fenster  -> UI.setFrequency(hz)            (Offset stimmt automatisch)
       - ausserhalb  -> erst Profil wechseln, dann per Offset abstimmen
     Gibt zurueck: true = abgestimmt, "profil" = Profilwechsel noetig, false = nichts. */
  function empfangenSetzen(hz) {
    hz = Math.round(hz);
    try {
      if (typeof UI === "undefined") { return false; }
      var fz = fensterJetzt();
      var drin = fz && Math.abs(hz - fz.mitte) <= fz.halb;
      /* innerhalb des Fensters: einfacher Weg */
      if (drin) {
        if (typeof UI.setFrequency === "function") { UI.setFrequency(hz); return true; }
        if (typeof UI.setCenterFrequency === "function") { UI.setCenterFrequency(hz); return true; }
        return false;
      }
      /* ausserhalb: nur per Offset geht es, und nur wenn das Fenster passt */
      if (fz && typeof UI.setOffsetFrequency === "function") {
        var off = hz - fz.mitte;
        if (Math.abs(off) <= fz.halb) { UI.setOffsetFrequency(off); return true; }
      }
    } catch (e) { }
    return false;
  }
  /* Kann die aktuelle Fensterlage diese Frequenz ueberhaupt erreichen? */
  function imFenster(hz) {
    var fz = fensterJetzt();
    if (!fz) { return true; }
    return Math.abs(Math.round(hz) - fz.mitte) <= fz.halb;
  }
  function empfangenModus(m) {
    var k = modusKlein(m);
    if (k === "data") { k = "usb"; }
    if (k === "fm") { k = "nfm"; }
    try {
      if (typeof UI === "undefined") { return false; }
      if (typeof UI.setModulation === "function") { UI.setModulation(k); return true; }
      var b = document.querySelector('.openwebrx-demodulator-button[data-modulation="' + k + '"]');
      if (b) { b.click(); return true; }
    } catch (e) { }
    return false;
  }
  function empfangenLesen() {
    try {
      if (typeof UI !== "undefined" && typeof UI.getFrequency === "function") {
        var f = parseInt(UI.getFrequency(), 10);
        if (f > 0) { return f; }
      }
    } catch (e) { }
    return 0;
  }
  /* Das Empfangsfenster: die Seite fuehrt center_freq und bandwidth global.
     ACHTUNG: UI.getBandwidth() gibt es NICHT - danach zu fragen liefert immer
     null und dann wird ohne Grenze abgestimmt. */
  function fensterJetzt() {
    try {
      if (typeof center_freq !== "undefined" && typeof bandwidth !== "undefined") {
        var m = parseInt(center_freq, 10), b = parseInt(bandwidth, 10);
        if (m > 0 && b > 0) { return { mitte: m, halb: b / 2, von: m - b / 2, bis: m + b / 2 }; }
      }
    } catch (e) { }
    return null;
  }

  /* ================= PROFIL / MENÜ / FUNKTIONEN =========================
     [PROFIL-VERDRAHTUNG] 20.11.2026: Die Geräte sollen am LAUFENDEN PROFIL
     hängen, nicht an erfundenen Werten. Der Receiver führt alles im Profil:
     Frequenzfenster, Band, Betriebsart. Die echte Profilliste steht in
     #openwebrx-sdr-profiles-listbox (948 Einträge, Wert "geraet|profil").
     Auswahl dort = echter Profilwechsel.                            */
  function profilListe() {
    var s = document.getElementById("openwebrx-sdr-profiles-listbox");
    return (s && s.options) ? s : null;
  }
  function profilJetzt() {
    var s = profilListe();
    if (!s || s.selectedIndex < 0) { return null; }
    var o = s.options[s.selectedIndex];
    if (!o) { return null; }
    return { wert: String(o.value || ""), text: String(o.textContent || "").trim() };
  }
  function profilKurz(t) {
    /* "🟢 RTL-USB HF | NESDR SMArt v5 🟡📡 HAM 80m | 3500–3800 kHz | LSB"
       -> "HAM 80m · 3500–3800 kHz"  (Emoji und Geraetename weg) */
    var x = String(t || "");
    x = x.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "");
    var teile = x.split("|").map(function (z) { return z.trim(); }).filter(Boolean);
    if (teile.length >= 2) { return teile.slice(-2).join(" · "); }
    return teile[0] || "—";
  }
  function profilNameKurz() {
    var p = profilJetzt();
    return p ? profilKurz(p.text) : "—";
  }
  /* Profil wirklich wechseln: Auswahl setzen und das change-Ereignis auslösen.
     Der Receiver hängt seine eigene Behandlung daran - nichts wird umgangen. */
  /* [PROFIL-SPERRE] 20.11.2026
     Auf 113 antwortet der Server Gaesten mit 403 FORBIDDEN, wenn sie ein
     anderes Profil waehlen. Das ist Absicht (Profile nur fuer admin und
     registrierte User). Das Geraet hat das bisher nicht gemerkt und weiter
     "Profil wechselt ..." gemeldet, obwohl nichts passierte - genau das war
     die "Verknuepfung stimmt nicht".
     Jetzt: nach dem Umschalten kurz nachsehen, ob der Receiver wirklich das
     neue Profil meldet. Wenn nicht, ehrlich sagen und zurueckstellen. */
  var PROFIL_SPERRE = { gesperrt: false, geprueft: false };
  function profilSperrePruefen() {
    try {
      var s = profilListe();
      if (!s) { return false; }
      var w = String(s.value || "");
      /* Nach dem Wechsel: steht der alte Wert noch da, hat es nicht geklappt */
      return (s.value === PROFIL_SPERRE.wunsch);
    } catch (e) { return false; }
  }
  function profilWechseln(wert, meldungRueck) {
    var s = profilListe();
    if (!s) { return false; }
    var gefunden = false;
    for (var i = 0; i < s.options.length; i++) {
      if (String(s.options[i].value) === String(wert)) { s.selectedIndex = i; gefunden = true; break; }
    }
    if (!gefunden) { return false; }
    var vorher = String(s.value || "");
    PROFIL_SPERRE.wunsch = String(wert);
    try {
      s.dispatchEvent(new Event("change", { bubbles: true }));
      var f = s.form || s.parentNode;
      if (f && f.dispatchEvent) { /* manche Receiver hören am Formular */ }
    } catch (e) { }
    /* [WICHTIG] Der Select-Wert aendert sich auch dann, wenn der Server den
       Wechsel mit 403 ablehnt - er ist also KEIN Beweis. Beweis ist allein
       das Empfangsfenster: erst wenn der Receiver auf dem neuen Profil
       laeuft, steht dort eine andere Mitte. */
    var mitteVorher = null;
    try { var fzv = fensterJetzt(); mitteVorher = fzv ? fzv.mitte : null; } catch (e) { }
    setTimeout(function () {
      var fzn = null;
      try { fzn = fensterJetzt(); } catch (e) { }
      var gewechselt = fzn && (mitteVorher === null || Math.abs(fzn.mitte - mitteVorher) > 1000);
      if (!gewechselt) {
        /* abgelehnt - Eintrag zurueckstellen, damit die Anzeige nicht luegt */
        try { s.value = vorher; } catch (e) { }
        PROFIL_SPERRE.gesperrt = true;
        PROFIL_SPERRE.geprueft = true;
        if (typeof PROFIL_SPERRE.melden === "function") { PROFIL_SPERRE.melden(wert); }
      } else {
        PROFIL_SPERRE.gesperrt = false;
        PROFIL_SPERRE.geprueft = true;
      }
    }, 4000);
    return true;
  }
  /* Profil zu einem Bandnamen finden: value (ham_80m, ham_ulf_fine) + Optionstext-Fallback */
  function profilFuerBand(bandName) {
    var s = profilListe();
    if (!s) { return null; }
    var slug = String(bandName || "").toLowerCase().replace(/\s+/g, "");
    var istUlf = (slug === "ulf" || slug === "vlf");
    var kennung = istUlf ? "ham_ulf" : ("ham_" + slug);
    var aliasSlug = (slug === "2200m") ? "2190m" : slug;
    var reText = istUlf ? /\b(ULF|VLF)\b/i : new RegExp("\\bHAM\\s*(?:" + slug + "|" + aliasSlug + ")\\b", "i");
    var exakt = [], fallback = [];
    for (var i = 0; i < s.options.length; i++) {
      var o = s.options[i];
      var w = String(o.value || "").toLowerCase();
      var t = String(o.textContent || "");
      if (w.indexOf("|" + kennung) >= 0) { exakt.push(o); }
      else if (reText.test(t)) { fallback.push(o); }
    }
    var treffer = exakt.length ? exakt : fallback;
    if (!treffer.length) { return null; }
    var jetzt = profilJetzt();
    var geraetJetzt = jetzt ? jetzt.wert.split("|")[0] : "";
    for (var k = 0; k < treffer.length; k++) {
      if (geraetJetzt && String(treffer[k].value).split("|")[0] === geraetJetzt) { return treffer[k]; }
    }
    /* Bevorzugt echte HAM-HF/110-SDRs vor allgemeinen Scannern */
    for (var m = 0; m < treffer.length; m++) {
      var dev = String(treffer[m].value || "").split("|")[0];
      if (dev.indexOf("rtl_usb") === 0) { return treffer[m]; }
    }
    return treffer[0];
  }
  /* Alle Profile, gruppiert - für das MENÜ */
  function profilGruppen() {
    var s = profilListe();
    if (!s) { return []; }
    var gruppen = {}, reihe = [];
    for (var i = 0; i < s.options.length; i++) {
      var o = s.options[i];
      var w = String(o.value || "");
      var geraet = w.split("|")[0] || "?";
      if (!gruppen[geraet]) { gruppen[geraet] = { id: geraet, titel: "", eintraege: [] }; reihe.push(gruppen[geraet]); }
      var t = String(o.textContent || "").trim();
      if (!gruppen[geraet].titel) {
        var ohneEmoji = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "").trim();
        gruppen[geraet].titel = ohneEmoji.split("|")[0].trim();
      }
      gruppen[geraet].eintraege.push({ wert: w, text: t, kurz: profilKurz(t) });
    }
    return reihe;
  }


  /* ================= Haptik-Klicks, Audio-Filter & RF-Gain-API ========= */
  var _klickCtx = null;
  function fgKlick(art) {
    try {
      if (!MENU_STAND || !MENU_STAND.ton) { return; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return; }
      if (!_klickCtx) { _klickCtx = new AC(); }
      if (_klickCtx.state === "suspended") { _klickCtx.resume().catch(function () {}); }
      var t = _klickCtx.currentTime;
      var osc = _klickCtx.createOscillator();
      var g = _klickCtx.createGain();
      var freq = (art === "dial") ? 1950 : (art === "rast" ? 860 : 1280);
      var dur = (art === "dial") ? 0.008 : (art === "rast" ? 0.015 : 0.011);
      var peak = (art === "dial") ? 0.018 : 0.028;
      osc.type = (art === "rast") ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 0.42), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.0012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(_klickCtx.destination);
      osc.start(t); osc.stop(t + dur + 0.002);
    } catch (e) { }
  }

  function afButtonFind(label) {
    try {
      var roots = [
        document.getElementById("audio-filter-panel"),
        document.getElementById("openwebrx-panel-receiver"),
        document.body
      ];
      var want = String(label || "").toLowerCase();
      for (var r = 0; r < roots.length; r++) {
        var root = roots[r];
        if (!root) { continue; }
        var btns = root.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].closest && btns[i].closest("#fg-geraet-0, #fg-geraet-1, #fg-menu")) { continue; }
          var txt = (btns[i].textContent || "").replace(/[^a-z]/gi, "").toLowerCase();
          if (txt === want) { return btns[i]; }
        }
      }
    } catch (e) { }
    return null;
  }
  function afKeyFor(label) {
    var l = String(label || "").toLowerCase();
    if (l === "nb") { return "openwebrx-audio-filter-declick"; }
    if (l === "nr") { return "openwebrx-audio-filter-nr"; }
    if (l === "notch") { return "openwebrx-audio-filter-autonotch"; }
    if (l === "eq") { return "openwebrx-audio-filter-enabled"; }
    if (l === "comp") { return "openwebrx-audio-filter-compressor"; }
    return "";
  }
  function afStateRead(label) {
    try {
      var l = String(label || "").toLowerCase();
      var k = afKeyFor(l);
      if (k) {
        var v = localStorage.getItem(k);
        if (v !== null) { return v === "true" || v === "1"; }
      }
      if (l === "nr") {
        var v2 = localStorage.getItem("nr_enabled");
        if (v2 !== null) { return v2 === "true" || v2 === "1"; }
      }
      var b = afButtonFind(label);
      if (b) {
        var bg = (b.style && b.style.backgroundColor) || "";
        return /rgb\(\s*(0|46|57|34|76)|#39ff14|green|lime/i.test(bg) || b.classList.contains("active") || b.classList.contains("highlighted");
      }
    } catch (e) { }
    return false;
  }
  function afSet(label, targetState) {
    try {
      var cur = afStateRead(label);
      if (typeof targetState === "boolean" && cur === targetState) { return cur; }
      var b = afButtonFind(label);
      if (b) { b.click(); return afStateRead(label); }
    } catch (e) { }
    return !!targetState;
  }

  var _rfSendTimer = null;
  var RF_MIN = 0, RF_MAX = 49;
  var _rfState = { darfAendern: true, qDirect: false, serverWert: null, modus: "manual", apiVorhanden: true };
  function rfProfil() {
    try {
      var box = document.getElementById("openwebrx-sdr-profiles-listbox");
      if (!box || !box.options || !box.options.length) { return null; }
      var o = box.options[box.selectedIndex >= 0 ? box.selectedIndex : 0];
      var v = (o && o.value ? o.value : "").split("|");
      if (v.length < 2 || !v[0] || !v[1]) { return null; }
      return { sdr: v[0], profil: v[1], name: (o.textContent || "").trim() };
    } catch (e) { return null; }
  }
  function rfIstQDirect(d, p) {
    if (d && typeof d.q_direct === "boolean") { return d.q_direct; }
    if (d && (d.direct_sampling === 1 || d.direct_sampling === 2)) { return true; }
    if (!p) { return false; }
    if (/q-direct/i.test(p.name || "")) { return true; }
    if (p.sdr === "rtl_usb_hf_60351967" &&
        !/^hf_2[5-9]/.test(p.profil || "") &&
        p.profil !== "16cfe6b2-b989-4715-8f66-073875db5c67") { return true; }
    if (p.sdr === "2d36da2b-4d3e-465b-b259-990fe7e2bbb4") { return true; }
    return false;
  }
  function rfSyncMenue() {
    try {
      var m = document.getElementById("fg-menu");
      if (!m) { return; }
      var sl = m.querySelector('[data-set="rf"]');
      var val = (_rfState.modus === "auto") ? 20 : ((MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf);
      if (sl && document.activeElement !== sl) { sl.value = String(val); }
      var rf = m.querySelector('[data-feld="rfwert"]');
      if (rf) { rf.textContent = (_rfState.modus === "auto") ? "AGC" : (val + " dB"); }
    } catch (e) { }
  }
  function rfMeldungKurz(txt) {
    try {
      var g2 = gGet();
      if (!g2) { return; }
      g2.meldung = txt;
      zeichnen();
      setTimeout(function () { if (g2.meldung === txt) { g2.meldung = ""; zeichnen(); } }, 2400);
    } catch (e) { }
  }
  function rfApiSenden(wert) {
    try {
      if (!_rfState.apiVorhanden) {
        rfMeldungKurz("RF-Gain " + wert + " dB (lokal)");
        return;
      }
      var p = rfProfil();
      if (!p) { return; }
      fetch("api/dnx-gain?sdr=" + encodeURIComponent(p.sdr) + "&profil=" + encodeURIComponent(p.profil), {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ modus: "manual", rf_gain: wert })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) { return { code: r.status, d: d }; });
        })
        .then(function (res) {
          if (res.code === 200 && res.d && res.d.ok) {
            var gw = (typeof res.d.geraet === "number") ? res.d.geraet :
                     ((typeof res.d.rf_gain === "number") ? res.d.rf_gain : wert);
            _rfState.modus = res.d.modus || "manual";
            _rfState.serverWert = gw;
            _rfState.qDirect = rfIstQDirect(res.d, p);
            MENU_STAND.rf = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(gw)));
            menuStandSichern();
            reglerSyncAlle();
            rfSyncMenue();
            try {
              window.dispatchEvent(new CustomEvent("dnx-rf-gain", {
                detail: { wert: gw, modus: _rfState.modus, qDirect: _rfState.qDirect, quelle: "funkgeraet", gespeichert: true }
              }));
            } catch (e1) { }
            rfMeldungKurz(_rfState.qDirect ? ("RF-Gain " + gw + " dB (Q-Direct: ohne Wirkung)") : ("RF-Gain " + gw + " dB"));
          } else if (res.code === 404 || res.code === 405 || res.code === 501) {
            _rfState.apiVorhanden = false;
            rfMeldungKurz("RF-Gain " + wert + " dB (lokal)");
          } else {
            if (res.code === 403) { _rfState.darfAendern = false; }
            rfMeldungKurz(res.code === 403 ? "RF-Gain: bitte anmelden (403)" :
              ("RF-Gain Fehler: " + ((res.d && res.d.fehler) || res.code)));
            rfApiLaden();
          }
        })
        .catch(function () {
          rfMeldungKurz("RF-Gain: keine Antwort");
        });
    } catch (e) { }
  }
  function rfAnwenden(wert) {
    var eff = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(wert)));
    var p = rfProfil();
    _rfState.qDirect = rfIstQDirect(null, p);
    if (_rfState.darfAendern === false) {
      if (_rfSendTimer) { clearTimeout(_rfSendTimer); _rfSendTimer = null; }
      if (typeof _rfState.serverWert === "number") {
        MENU_STAND.rf = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(_rfState.serverWert)));
        menuStandSichern();
      }
      reglerSyncAlle();
      rfSyncMenue();
      rfMeldungKurz("RF-Gain: bitte anmelden");
      return;
    }
    _rfState.modus = "manual";
    MENU_STAND.rf = eff;
    menuStandSichern();
    try {
      window.dispatchEvent(new CustomEvent("dnx-rf-gain", {
        detail: { wert: eff, modus: "manual", qDirect: _rfState.qDirect, quelle: "funkgeraet" }
      }));
    } catch (e) { }
    if (_rfState.qDirect) { rfMeldungKurz("RF-Gain " + eff + " dB (Q-Direct: ohne Wirkung)"); }
    if (_rfSendTimer) { clearTimeout(_rfSendTimer); }
    _rfSendTimer = setTimeout(function () { _rfSendTimer = null; rfApiSenden(eff); }, 900);
  }
  function rfApiLaden() {
    try {
      if (!_rfState.apiVorhanden) { return; }
      var p = rfProfil();
      if (!p) { return; }
      fetch("api/dnx-gain?sdr=" + encodeURIComponent(p.sdr) + "&profil=" + encodeURIComponent(p.profil), { credentials: "same-origin" })
        .then(function (r) {
          if (r.status === 404 || r.status === 405 || r.status === 501) {
            _rfState.apiVorhanden = false;
            return { code: r.status, d: null };
          }
          return r.json().catch(function () { return null; }).then(function (d) { return { code: r.status, d: d }; });
        })
        .then(function (res) {
          if (!res || res.code !== 200 || !res.d || !res.d.ok) { return; }
          var d = res.d;
          if (typeof d.darf_aendern === "boolean") { _rfState.darfAendern = d.darf_aendern; }
          _rfState.qDirect = rfIstQDirect(d, p);
          _rfState.modus = d.modus || "manual";
          var gVal = (typeof d.geraet === "number") ? d.geraet :
                     ((typeof d.rf_gain === "number") ? d.rf_gain : null);
          var mVal = (d.mein !== null && d.mein !== undefined && d.mein !== "auto" && typeof d.mein === "number") ? d.mein : null;
          var w = (gVal !== null) ? gVal : mVal;
          if (_rfState.modus === "auto") {
            _rfState.serverWert = null;
          } else if (typeof w === "number") {
            _rfState.serverWert = w;
            MENU_STAND.rf = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(w)));
            menuStandSichern();
          }
          reglerSyncAlle();
          rfSyncMenue();
          try {
            window.dispatchEvent(new CustomEvent("dnx-rf-gain-sync", {
              detail: {
                wert: typeof w === "number" ? w : MENU_STAND.rf,
                modus: _rfState.modus,
                darfAendern: _rfState.darfAendern,
                qDirect: _rfState.qDirect,
                quelle: "funkgeraet"
              }
            }));
          } catch (e2) { }
        }).catch(function () {});
    } catch (e) { }
  }

  var SM_SMOOTH = [0, 0, 0];
  var SM_PEAK = [{ v: 0, t: 0 }, { v: 0, t: 0 }, { v: 0, t: 0 }];
  function smeterGlaetten(i, target) {
    var cur = SM_SMOOTH[i] || 0;
    var t = Math.max(0, Math.min(1, target || 0));
    var a = (t > cur) ? 0.34 : 0.12;
    var next = cur + (t - cur) * a;
    if (Math.abs(next - t) < 0.002) { next = t; }
    SM_SMOOTH[i] = next;
    var pk = SM_PEAK[i] || (SM_PEAK[i] = { v: 0, t: 0 });
    var now = Date.now();
    if (next >= pk.v) { pk.v = next; pk.t = now; }
    else if (now - pk.t > 950) { pk.v = Math.max(next, pk.v - 0.014); }
    return next;
  }

  function passbandAktualisieren(w, istG2) {
    if (!w) { return; }
    var bi = demodBandInfo();
    var bw = (MENU_STAND.filt && MENU_STAND.filt !== 2400) ? MENU_STAND.filt : Math.max(100, Math.round(Math.abs((bi.hi || 2400) - (bi.lo || -2400))));
    var bwTxt = bw >= 1000 ? ((bw / 1000).toFixed(1).replace(/\.0$/, "") + "k") : (bw + "Hz");
    var rfCell = w.querySelector('[data-feld="rfilval"]');
    if (rfCell) { rfCell.textContent = bwTxt; }
    var agcCell = w.querySelector('[data-feld="agcval"]');
    if (agcCell) { agcCell.textContent = String(MENU_STAND.agc || "auto").toUpperCase(); }
    var attCell = w.querySelector('[data-feld="attval"]');
    if (attCell) { attCell.textContent = MENU_STAND.att ? ("-" + MENU_STAND.att + "dB") : "OFF"; }
    var ipoCell = w.querySelector('[data-feld="ipoval"]');
    if (ipoCell) { ipoCell.textContent = MENU_STAND.pre ? "AMP2" : "IPO"; }
    var svg = w.querySelector(".ft-pb-svg, .ts-pb-svg, .ic-pb-svg, .w1-pb-svg, .w2-pb-svg");
    if (svg) {
      var isFt = svg.classList.contains("ft-pb-svg");
      var isTs = svg.classList.contains("ts-pb-svg");
      var isIc = svg.classList.contains("ic-pb-svg");
      var shape = svg.querySelector("path[data-pb]");
      if (shape) {
        var frac = Math.max(0.10, Math.min(0.84, bw / 12000));
        var mid = (istG2 || isFt || isTs || isIc) ? 60 : 74;
        var scale = (istG2 || isFt || isTs || isIc) ? 44 : 55;
        var yBase = (isTs || isIc) ? 12 : (isFt ? 14 : (istG2 ? 17 : 18));
        var half = Math.round(frac * scale);
        var x1 = mid - half, x2 = mid + half;
        shape.setAttribute("d", "M " + (x1 - 5) + " " + yBase + " L " + x1 + " 3 L " + x2 + " 3 L " + (x2 + 5) + " " + yBase);
        var bar = svg.querySelector("rect[data-pbbar]");
        if (bar) {
          bar.setAttribute("x", String(x1 + 3));
          bar.setAttribute("width", String(Math.max(4, (x2 - x1) - 6)));
        }
      }
    }
  }

  /* ---- echte Receiver-Bedienelemente -------------------------------- */
  function demodKlick(modus) {
    var k = modusKlein(modus);
    if (k === "data") { k = "usb"; }
    if (k === "fm") { k = "nfm"; }
    var b = document.querySelector('.openwebrx-demodulator-button[data-modulation="' + k + '"]');
    if (b) { b.click(); return true; }
    return empfangenModus(modus);
  }
  function lautstaerkeSetzen(wert) {
    var s = document.getElementById("openwebrx-panel-volume");
    if (!s) { return false; }
    s.value = String(wert);
    try {
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { }
    return true;
  }
  function lautstaerkeJetzt() {
    var s = document.getElementById("openwebrx-panel-volume");
    return s ? parseInt(s.value, 10) : null;
  }

  /* ================= Abstimmrad ======================================== */
  function radBinden(el, beiDreh) {
    if (!el || el.__dnxRadFang) { return; }
    el.__dnxRadFang = 1;
    var letzte = null, winkel = 0, rest = 0;
    el.style.cursor = "grab";
    el.tabIndex = 0;
    el.title = "Drehen: ziehen, Mausrad oder Pfeiltasten (Gerät muss im Empfangsfenster liegen)";
    el.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "+") {
        e.preventDefault(); winkel += 12; radDrehen(el, winkel); fgKlick("dial"); beiDreh(1);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "-") {
        e.preventDefault(); winkel -= 12; radDrehen(el, winkel); fgKlick("dial"); beiDreh(-1);
      }
    });
    el.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      winkel += (ev.deltaY > 0 ? 1 : -1) * 12;
      radDrehen(el, winkel);
      fgKlick("dial");
      beiDreh(ev.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    function onMove(e) {
      if (letzte === null) { return; }
      e.stopPropagation();
      if (e.cancelable && e.preventDefault) { e.preventDefault(); }
      var d = letzte - e.clientY; letzte = e.clientY;
      if (!d) { return; }
      winkel += d * 1.4; radDrehen(el, winkel);
      rest += d;
      while (Math.abs(rest) >= 3) {
        var rich = rest > 0 ? 1 : -1;
        rest -= rich * 3;
        fgKlick("dial");
        beiDreh(rich);
      }
    }
    function onUp(e) {
      if (letzte === null) { return; }
      if (e && e.stopPropagation) { e.stopPropagation(); }
      letzte = null; rest = 0; el.style.cursor = "grab";
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onUp, true);
    }
    el.addEventListener("pointerdown", function (e) {
      if (e && e.button && e.button !== 0) { return; }
      letzte = e.clientY; rest = 0; el.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove, { capture: true, passive: false });
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      window.addEventListener("blur", onUp, true);
      e.preventDefault();
      e.stopPropagation();
    });
  }
  function radDrehen(el, winkel) {
    var kappe = el.querySelector(".kappe");
    if (kappe) { kappe.style.transform = "rotate(" + (winkel % 360) + "deg)"; }
    var ring = el.querySelector(".ring");
    if (ring) { ring.style.transform = "rotate(" + (winkel * 0.18 % 360) + "deg)"; }
  }

  /* ================= S-Meter =========================================== */
  /* ================= S-Meter: senkrechte Balken (nach Vorlage) ==========
     1:1 aus 113-funkgeraete-vorlagen.html uebernommen:
        smeterBauen(el, anzahl)  baut `anzahl` Balken, Hoehe 6px + i*0.55px
        smeterSetzen(balken, w)  w = 0..1, schaltet die ersten n Balken an
                                 ab 66 % gelb (.w), ab 82 % rot (.r)
     Der Pegel (0..1) kommt weiter aus smeterAnteil(), also aus der echten
     Receiver-Rechnung db = 10*log10(smeter_level) und dem Fenster aus
     Waterfall.getRange(). */
  function smeterBauen(el, anzahl) {
    if (!el) { return []; }
    el.innerHTML = "";
    var arr = [];
    for (var i = 0; i < anzahl; i++) {
      var b = document.createElement("i");
      b.style.height = (6 + i * (anzahl > 20 ? 0.55 : 0.8)) + "px";
      el.appendChild(b);
      arr.push(b);
    }
    return arr;
  }
  /* ================= Bogen aus Balken (Gerät 1, auf Wunsch) ==============
     Dieselben Balken wie in der Vorlage, aber auf einem Kreisbogen verteilt.
     Gezeichnet wird nichts mit SVG: jeder Balken ist ein <i>, das auf seinem
     Punkt des Bogens sitzt und um den Winkel gedreht ist (transform-origin
     unten Mitte), damit er wie eine Nadel radial nach aussen zeigt.
     Der Radius ist so gewaehlt, dass der Bogen in den Kasten passt. */
  function bogenBauen(el, anzahl, breite, hoehe) {
    if (!el) { return { balken: [], texte: [] }; }
    el.innerHTML = "";
    var i, w, rad, x, y, h;

    /* Flacher 3DSS-Skalenbogen mit weissem S1-9-Bereich, blauem +20..+60-dB-Bereich,
       innerer PO-Skala (0..150 W) und laufender roter Nadel. */
    var istKompakt = (breite < 168);
    var WINKEL = istKompakt ? 29 : 33;
    var rIn = istKompakt ? 104 : 122;
    var cx = breite / 2;
    var cy = rIn + (istKompakt ? 13 : 15);

    function pt(r, deg) {
      var rd = deg * Math.PI / 180;
      return (cx + r * Math.sin(rd)).toFixed(1) + "," + (cy - r * Math.cos(rd)).toFixed(1);
    }

    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + breite + " " + hoehe);
    svg.setAttribute("class", "w1-sm-svg");
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";

    function arcPath(r, d1, d2) {
      return "M " + pt(r, d1) + " A " + r + " " + r + " 0 0 1 " + pt(r, d2);
    }
    function addEl(tag, attrs, txt) {
      var n = document.createElementNS(svgNS, tag);
      for (var k in attrs) { n.setAttribute(k, attrs[k]); }
      if (txt !== undefined) { n.textContent = txt; }
      svg.appendChild(n);
      return n;
    }

    /* S-Meter Hintergrundbeleuchtung (realistisches Instrumentenlicht) */
    var defs = addEl("defs", {});
    var rg = document.createElementNS(svgNS, "radialGradient");
    rg.setAttribute("id", "w1SmGlowGrad");
    rg.setAttribute("cx", "50%"); rg.setAttribute("cy", "92%"); rg.setAttribute("r", "78%");
    var st1 = document.createElementNS(svgNS, "stop");
    st1.setAttribute("offset", "0%"); st1.setAttribute("stop-color", "#dbeafe"); st1.setAttribute("stop-opacity", "0.34");
    var st2 = document.createElementNS(svgNS, "stop");
    st2.setAttribute("offset", "55%"); st2.setAttribute("stop-color", "#60a5fa"); st2.setAttribute("stop-opacity", "0.14");
    var st3 = document.createElementNS(svgNS, "stop");
    st3.setAttribute("offset", "100%"); st3.setAttribute("stop-color", "#0f172a"); st3.setAttribute("stop-opacity", "0.0");
    rg.appendChild(st1); rg.appendChild(st2); rg.appendChild(st3);
    defs.appendChild(rg);

    var rGlowOut = rIn + (istKompakt ? 12 : 14), rGlowIn = istKompakt ? 72 : 84;
    var gW = istKompakt ? 31 : 36;
    var gPath = "M " + pt(rGlowOut, -gW) + " A " + rGlowOut + " " + rGlowOut + " 0 0 1 " + pt(rGlowOut, gW) +
                " L " + pt(rGlowIn, gW) + " A " + rGlowIn + " " + rGlowIn + " 0 0 0 " + pt(rGlowIn, -gW) + " Z";
    addEl("path", { d: gPath, fill: "url(#w1SmGlowGrad)" });

    /* Aeussere S-Bogenlinie: weiss bis S9 (+3.5 deg), blau bis +60 */
    var sW = istKompakt ? 29.5 : 33.5;
    addEl("path", { d: arcPath(rIn - 7, -sW, 3.6), fill: "none", stroke: "#f1f5f9", "stroke-width": "1.3", opacity: "0.95" });
    addEl("path", { d: arcPath(rIn - 7, 3.6, sW), fill: "none", stroke: "#60a5fa", "stroke-width": "1.7", opacity: "1" });

    /* Innere PO-Bogenlinie + Teilstriche + Ziffern (0, 10, 50, 100, 150 W) */
    var rPO = istKompakt ? 86 : 100;
    addEl("path", { d: arcPath(rPO, -28, 28), fill: "none", stroke: "#e2e8f0", "stroke-width": "1.1", opacity: "0.9" });
    var poVals = istKompakt ? [[-23, "0"], [-11.5, "10"], [0, "50"], [11.5, "100"], [23, "150"]] : [[-26, "0"], [-13, "10"], [0, "50"], [13, "100"], [26, "150"]];
    for (var p = 0; p < poVals.length; p++) {
      var pd = poVals[p][0], pl = poVals[p][1];
      var rdP = pd * Math.PI / 180;
      addEl("line", {
        x1: (cx + rPO * Math.sin(rdP)).toFixed(1),
        y1: (cy - rPO * Math.cos(rdP)).toFixed(1),
        x2: (cx + (rPO - 3.5) * Math.sin(rdP)).toFixed(1),
        y2: (cy - (rPO - 3.5) * Math.cos(rdP)).toFixed(1),
        stroke: "#e2e8f0", "stroke-width": "1.1"
      });
      addEl("text", {
        x: (cx + (rPO - (istKompakt ? 8.5 : 10)) * Math.sin(rdP)).toFixed(1),
        y: (cy - (rPO - (istKompakt ? 8.5 : 10)) * Math.cos(rdP) + (istKompakt ? 1.8 : 2)).toFixed(1),
        fill: "#f1f5f9", "font-size": istKompakt ? "7.4" : "7.5", "font-weight": "800",
        "font-family": "ui-monospace,monospace", "text-anchor": "middle"
      }, pl);
    }
    addEl("text", { x: istKompakt ? "14" : "26", y: String(hoehe - 3), fill: "#cbd5e1", "font-size": istKompakt ? "8.0" : "7.5", "font-weight": "800", "font-style": "italic", "font-family": "system-ui" }, "PO");
    addEl("text", { x: String(breite - (istKompakt ? 22 : 24)), y: String(hoehe - 3), fill: "#cbd5e1", "font-size": istKompakt ? "8.0" : "7.5", "font-weight": "800", "font-style": "italic", "font-family": "system-ui" }, "W");
    addEl("text", { x: istKompakt ? "4" : "5", y: istKompakt ? "27" : "28", fill: "#ffffff", "font-size": istKompakt ? "10.5" : "10", "font-weight": "900", "font-style": "italic", "font-family": "system-ui" }, "S");
    addEl("text", { x: String(breite - (istKompakt ? 3 : 14)), y: istKompakt ? "27" : "20", fill: "#93c5fd", "font-size": istKompakt ? "8.0" : "7.5", "font-weight": "800", "font-family": "system-ui", "text-anchor": istKompakt ? "end" : "start" }, "dB");
    el.appendChild(svg);

    var SKALA = ["1", "3", "5", "7", "9", "+20", "+40", "+60"];
    var hauptIdx = {};
    var k;
    for (k = 0; k < SKALA.length; k++) {
      hauptIdx[Math.round(k * (anzahl - 1) / (SKALA.length - 1))] = k;
    }

    var balken = [], texte = [];
    for (i = 0; i < anzahl; i++) {
      w = -WINKEL + i * (2 * WINKEL / (anzahl - 1));
      rad = w * Math.PI / 180;
      x = cx + Math.sin(rad) * rIn;
      y = cy - Math.cos(rad) * rIn;
      var istHaupt = hauptIdx[i] !== undefined;
      h = istHaupt ? 8 : 5;
      var b = document.createElement("i");
      if (istHaupt) { b.setAttribute("data-h", "1"); }
      b.style.height = h + "px";
      b.style.left = (x - (istHaupt ? 1.0 : 0.7)).toFixed(1) + "px";
      b.style.top = (y + (istHaupt ? 0 : 2)).toFixed(1) + "px";
      b.style.transform = "rotate(" + w.toFixed(1) + "deg)";
      b.style.transformOrigin = "50% 0";
      el.appendChild(b);
      balken.push(b);
      b.__haupt = istHaupt;
    }

    var rTxt = rIn + (istKompakt ? 7.6 : 8.5);
    for (k = 0; k < SKALA.length; k++) {
      i = Math.round(k * (anzahl - 1) / (SKALA.length - 1));
      w = -WINKEL + i * (2 * WINKEL / (anzahl - 1));
      rad = w * Math.PI / 180;
      var t = document.createElement("span");
      t.textContent = SKALA[k];
      if (k >= 5) { t.className = "kl"; }
      t.setAttribute("data-k", String(k));
      t.style.left = (cx + Math.sin(rad) * rTxt).toFixed(1) + "px";
      t.style.top = (cy - Math.cos(rad) * rTxt).toFixed(1) + "px";
      el.appendChild(t);
      texte.push(t);
    }

    var nadelPk = document.createElement("div");
    nadelPk.className = "w1-nadel-pk";
    nadelPk.style.cssText = "position:absolute;width:1.4px;border-radius:1px;pointer-events:none;opacity:.62;" +
      "background:linear-gradient(180deg,#fbbf24 0%,rgba(251,191,36,.35) 38%,transparent 55%);" +
      "left:" + (cx - 0.7).toFixed(1) + "px;top:" + (cy - rIn - 3) + "px;height:" + (rIn + 3) + "px;" +
      "transform-origin:50% 100%;transform:rotate(-33deg)";
    el.appendChild(nadelPk);

    var nadel = document.createElement("div");
    nadel.className = "w1-nadel";
    nadel.style.cssText = "position:absolute;width:1.8px;border-radius:1px;pointer-events:none;" +
      "left:" + (cx - 0.9).toFixed(1) + "px;top:" + (cy - rIn - 2) + "px;height:" + (rIn + 2) + "px;" +
      "transform-origin:50% 100%;transform:rotate(-33deg)";
    el.appendChild(nadel);

    return { balken: balken, texte: texte, nadel: nadel, nadelPk: nadelPk, winkel: WINKEL };
  }
  function bogenSetzen(bo, wert, peakWert) {
    if (!bo || !bo.balken || !bo.balken.length) { return; }
    var v = Math.max(0, Math.min(1, wert || 0));
    var pk = Math.max(v, Math.min(1, (peakWert !== undefined ? peakWert : v) || 0));
    var len = bo.balken.length;
    var n = Math.round(v * len);
    var pIdx = Math.max(-1, Math.min(len - 1, Math.round(pk * len) - 1));
    var i;
    for (i = 0; i < len; i++) {
      var an = i < n;
      var hKlasse = bo.balken[i].getAttribute("data-h") ? "h" : "";
      var farb = an ? ("an" + (i >= 22 ? " r" : (i >= 15 ? " w" : ""))) : ((pIdx >= n && i === pIdx) ? "pk" : "");
      bo.balken[i].className = (hKlasse + " " + farb).replace(/^\s+|\s+$/g, "");
    }
    if (bo.texte) {
      for (i = 0; i < bo.texte.length; i++) {
        var kk = bo.texte[i].getAttribute("data-k");
        var grund = (parseInt(kk, 10) >= 5) ? "kl" : "";
        bo.texte[i].className = (grund + " an").replace(/^\s+|\s+$/g, "");
      }
    }
    if (bo.nadel) {
      var ang = -(bo.winkel || 36) + v * 2 * (bo.winkel || 36);
      bo.nadel.style.transform = "rotate(" + ang.toFixed(1) + "deg)";
    }
    if (bo.nadelPk) {
      var pAng = -(bo.winkel || 36) + pk * 2 * (bo.winkel || 36);
      bo.nadelPk.style.transform = "rotate(" + pAng.toFixed(1) + "deg)";
    }
  }

  /* Warm beleuchtetes Analog-S-Meter fuer Funkgeraet 2 (elfenbeinweiss, Kenwood-Skala) */
  function meterBauenV2(el, breite, hoehe) {
    if (!el) { return { meterV2: true }; }
    el.innerHTML = "";
    var istKompakt = (breite <= 145);
    var WINKEL = istKompakt ? 34 : 38;
    var cx = breite / 2;
    var rS = istKompakt ? 78 : 104;
    var cy = rS + (istKompakt ? 14 : 16);
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + breite + " " + hoehe);
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden";
    function pt(r, deg) {
      var rd = deg * Math.PI / 180;
      return (cx + r * Math.sin(rd)).toFixed(1) + "," + (cy - r * Math.cos(rd)).toFixed(1);
    }
    function arc(r, d1, d2) {
      return "M " + pt(r, d1) + " A " + r + " " + r + " 0 0 1 " + pt(r, d2);
    }
    function add(tag, attrs, txt) {
      var n = document.createElementNS(svgNS, tag);
      for (var k in attrs) { n.setAttribute(k, attrs[k]); }
      if (txt !== undefined) { n.textContent = txt; }
      svg.appendChild(n);
      return n;
    }
    var gid = "w2sm_" + Math.random().toString(36).slice(2, 8);
    var defs = add("defs", {});
    var rg = document.createElementNS(svgNS, "radialGradient");
    rg.setAttribute("id", gid);
    rg.setAttribute("cx", "50%");
    rg.setAttribute("cy", "88%");
    rg.setAttribute("r", "82%");
    [["0%", "#fffbe4"], ["58%", "#f4e0ad"], ["100%", "#cbb483"]].forEach(function (st) {
      var sp = document.createElementNS(svgNS, "stop");
      sp.setAttribute("offset", st[0]);
      sp.setAttribute("stop-color", st[1]);
      rg.appendChild(sp);
    });
    defs.appendChild(rg);
    add("rect", { x: "0", y: "0", width: String(breite), height: String(hoehe), fill: "url(#" + gid + ")" });
    add("path", { d: arc(rS, -38, 4), fill: "none", stroke: "#1f2937", "stroke-width": "1.6" });
    add("path", { d: arc(rS, 4, 38), fill: "none", stroke: "#dc2626", "stroke-width": "2.2" });
    var ticks = istKompakt
      ? [[-32,"1"],[-23,"3"],[-14,"5"],[-5,"7"],[4,"9"],[13,"+20"],[23,"+40"],[32,"+60"]]
      : [[-36,"1"],[-26,"3"],[-16,"5"],[-6,"7"],[4,"9"],[15,"+20"],[26,"+40"],[36,"+60"]];
    var rLbl = rS + (istKompakt ? 6.2 : 7.5);
    for (var i = 0; i < ticks.length; i++) {
      var d = ticks[i][0], lb = ticks[i][1], rd = d * Math.PI / 180, red = d > 4;
      add("line", {
        x1: (cx + rS * Math.sin(rd)).toFixed(1), y1: (cy - rS * Math.cos(rd)).toFixed(1),
        x2: (cx + (rS - (istKompakt ? 4.2 : 5.5)) * Math.sin(rd)).toFixed(1), y2: (cy - (rS - (istKompakt ? 4.2 : 5.5)) * Math.cos(rd)).toFixed(1),
        stroke: red ? "#dc2626" : "#111827", "stroke-width": istKompakt ? "1.1" : "1.3"
      });
      add("text", {
        x: (cx + rLbl * Math.sin(rd)).toFixed(1), y: (cy - rLbl * Math.cos(rd) + (istKompakt ? 2.0 : 2.5)).toFixed(1),
        fill: red ? "#b91c1c" : "#111827", "font-size": istKompakt ? (red ? "5.8" : "6.8") : (red ? "7" : "8"), "font-weight": "800",
        "font-family": "ui-monospace,monospace", "text-anchor": "middle"
      }, lb);
    }
    for (var s = -WINKEL + 4; s <= WINKEL - 4; s += 4) {
      var rs = s * Math.PI / 180;
      add("line", {
        x1: (cx + rS * Math.sin(rs)).toFixed(1), y1: (cy - rS * Math.cos(rs)).toFixed(1),
        x2: (cx + (rS - 2.3) * Math.sin(rs)).toFixed(1), y2: (cy - (rS - 2.3) * Math.cos(rs)).toFixed(1),
        stroke: s > 4 ? "#dc2626" : "#374151", "stroke-width": "0.75"
      });
    }
    var rPO = istKompakt ? 62 : 84;
    add("path", { d: arc(rPO, -WINKEL + 5, WINKEL - 5), fill: "none", stroke: "#4b5563", "stroke-width": "0.9" });
    var po = istKompakt ? [[-26,"0"],[-13,"25"],[0,"50"],[13,"100"],[26,"150"]] : [[-30,"0"],[-15,"25"],[0,"50"],[15,"100"],[30,"150"]];
    for (i = 0; i < po.length; i++) {
      var dp = po[i][0] * Math.PI / 180;
      add("line", {
        x1: (cx + rPO * Math.sin(dp)).toFixed(1), y1: (cy - rPO * Math.cos(dp)).toFixed(1),
        x2: (cx + (rPO - 2.5) * Math.sin(dp)).toFixed(1), y2: (cy - (rPO - 2.5) * Math.cos(dp)).toFixed(1),
        stroke: "#374151", "stroke-width": "0.8"
      });
      add("text", {
        x: (cx + (rPO - (istKompakt ? 6.8 : 8.5)) * Math.sin(dp)).toFixed(1), y: (cy - (rPO - (istKompakt ? 6.8 : 8.5)) * Math.cos(dp) + 1.8).toFixed(1),
        fill: "#374151", "font-size": istKompakt ? "5.8" : "6.8", "font-weight": "700", "font-family": "ui-monospace,monospace", "text-anchor": "middle"
      }, po[i][1]);
    }
    if (!istKompakt) {
      var rSWR = 67;
      add("path", { d: arc(rSWR, -25, 0), fill: "none", stroke: "#374151", "stroke-width": "0.9" });
      add("path", { d: arc(rSWR, 0, 25), fill: "none", stroke: "#dc2626", "stroke-width": "1.1" });
    }
    add("text", { x: istKompakt ? "4" : "6", y: String(hoehe - (istKompakt ? 10 : 13)), fill: "#111827", "font-size": istKompakt ? "6.2" : "7.5", "font-weight": "800", "font-family": "system-ui" }, "PO");
    if (!istKompakt) { add("text", { x: "6", y: String(hoehe - 4), fill: "#374151", "font-size": "7", "font-weight": "800", "font-family": "system-ui" }, "SWR"); }
    add("text", { x: istKompakt ? "5" : "10", y: istKompakt ? "11" : "14", fill: "#111827", "font-size": istKompakt ? "7.5" : "9", "font-weight": "900", "font-family": "system-ui" }, "S");
    add("text", { x: String(breite - (istKompakt ? 14 : 18)), y: istKompakt ? "11" : "14", fill: "#b91c1c", "font-size": istKompakt ? "6.5" : "7.5", "font-weight": "800", "font-family": "system-ui" }, "dB");
    add("text", { x: String(breite - (istKompakt ? 18 : 22)), y: String(hoehe - 3), fill: "#dc2626", "font-size": istKompakt ? "6.0" : "7", "font-weight": "800", "font-family": "system-ui" }, "ALC");
    el.appendChild(svg);

    var nadelPk = document.createElement("div");
    nadelPk.className = "w2-nadel-pk";
    nadelPk.style.cssText = "position:absolute;width:1.4px;border-radius:1px;pointer-events:none;opacity:.52;" +
      "background:linear-gradient(180deg,#d97706 0%,rgba(217,119,6,.25) 45%,transparent 70%);" +
      "left:" + (cx - 0.7).toFixed(1) + "px;top:" + (cy - rS - 2) + "px;height:" + (rS + 2) + "px;" +
      "transform-origin:50% 100%;transform:rotate(-38deg)";
    el.appendChild(nadelPk);

    var nadel = document.createElement("div");
    nadel.className = "w2-nadel";
    nadel.style.cssText = "position:absolute;width:1.8px;border-radius:1px;pointer-events:none;" +
      "left:" + (cx - 0.9).toFixed(1) + "px;top:" + (cy - rS - 2) + "px;height:" + (rS + 2) + "px;" +
      "transform-origin:50% 100%;transform:rotate(-38deg)";
    el.appendChild(nadel);

    var hub = document.createElement("div");
    hub.className = "w2-meter-hub";
    el.appendChild(hub);
    return { meterV2: true, nadel: nadel, nadelPk: nadelPk, winkel: WINKEL };
  }
  function meterSetzenV2(m, wert, peakWert) {
    if (!m || !m.nadel) { return; }
    var v = Math.max(0, Math.min(1, wert || 0));
    var pk = Math.max(v, Math.min(1, (peakWert !== undefined ? peakWert : v) || 0));
    var ang = -(m.winkel || 38) + v * 2 * (m.winkel || 38);
    m.nadel.style.transform = "rotate(" + ang.toFixed(1) + "deg)";
    if (m.nadelPk) {
      var pAng = -(m.winkel || 38) + pk * 2 * (m.winkel || 38);
      m.nadelPk.style.transform = "rotate(" + pAng.toFixed(1) + "deg)";
    }
    try {
      var mw = m.nadel.closest(".w2-meter-wrap, .ts-meter-wrap");
      var pkLed = mw && mw.querySelector('[data-feld="meterpk"]');
      if (pkLed) { pkLed.classList.toggle("an", pk > 0.78); }
    } catch (ePk) { }
  }
  /* Digitales Mehrfarben-Balken-S-Meter fuer Funkgeraet 3 (S1..S9..+60dB + Po) */
  function meterBauenV3(el) {
    if (!el) { return { meterV3: true, segs: [] }; }
    el.innerHTML = "";
    var hdr = document.createElement("div");
    hdr.className = "ic-sm-scale";
    hdr.innerHTML =
      '<span class="ic-sm-k">S</span>' +
      '<span>1</span><span>3</span><span>5</span><span>7</span><span>9</span>' +
      '<span class="r">+20</span><span class="r">+40</span><span class="r">+60<small>dB</small></span>';
    el.appendChild(hdr);

    var bar = document.createElement("div");
    bar.className = "ic-sm-bar";
    var segs = [];
    var total = 32;
    for (var s = 0; s < total; s++) {
      var d = document.createElement("i");
      if (s >= 20) { d.className = "red"; }
      else if (s >= 15) { d.className = "mid"; }
      bar.appendChild(d);
      segs.push(d);
    }
    el.appendChild(bar);

    var bot = document.createElement("div");
    bot.className = "ic-sm-po";
    bot.innerHTML = '<span>Po 0</span><span>25</span><span>50</span><span>100%</span><em data-feld="db">—</em>';
    el.appendChild(bot);
    return { meterV3: true, segs: segs };
  }
  function meterSetzenV3(m, wert, peakWert) {
    if (!m || !m.segs || !m.segs.length) { return; }
    var v = Math.max(0, Math.min(1, wert || 0));
    var pk = Math.max(v, Math.min(1, (peakWert !== undefined ? peakWert : v) || 0));
    var n = Math.round(v * m.segs.length);
    var pkIdx = (pk > 0.03) ? Math.max(0, Math.min(m.segs.length - 1, Math.round(pk * m.segs.length) - 1)) : -1;
    for (var i = 0; i < m.segs.length; i++) {
      var seg = m.segs[i];
      var base = (i >= 20) ? "red" : ((i >= 15) ? "mid" : "");
      var st = (i < n) ? "an" : ((i === pkIdx && pkIdx >= n) ? "pk" : "");
      seg.className = base ? (st ? (base + " " + st) : base) : st;
    }
  }
  function smeterSetzen(balken, wert) {
    if (!balken || !balken.length) { return; }
    var n = Math.round(Math.max(0, Math.min(1, wert || 0)) * balken.length);
    for (var i = 0; i < balken.length; i++) {
      var an = i < n;
      balken[i].className = an ? ("an" + (i > balken.length * 0.82 ? " r" : (i > balken.length * 0.66 ? " w" : ""))) : "";
    }
  }
  /* [ECHTES S-METER] 20.11.2026: window.smeter_level ist ein ROHANTEIL
     (etwa 1,3e-7), kein Prozentwert. Vorher wurde er als 0..1 gelesen - der
     Balken stand dadurch immer am Anschlag. Der Receiver rechnet selbst:
     dB = 10*log10(roh), dann bezogen auf das Wasserfall-Fenster
     (Waterfall.getRange() = min..max). Genau das wird hier nachgebaut. */
  function smeterRoh() {
    try {
      if (typeof window.smeter_level === "number" && isFinite(window.smeter_level) && window.smeter_level > 0) {
        return window.smeter_level;
      }
    } catch (e) { }
    return 0;
  }
  function smeterDb() {
    var roh = smeterRoh();
    if (!(roh > 0)) { return null; }
    return 10 * Math.log10(roh);
  }
  function smeterAnteil() {
    var db = smeterDb();
    if (db === null) { return 0; }
    var min = -120, max = 0;
    try {
      if (typeof Waterfall !== "undefined" && typeof Waterfall.getRange === "function") {
        var r = Waterfall.getRange();
        if (r && isFinite(r.min) && isFinite(r.max)) { min = r.min; max = r.max; }
      }
    } catch (e) { }
    var anteil = (db - (min - 20)) / ((max + 20) - (min - 20));
    if (!isFinite(anteil)) { return 0; }
    return Math.max(0, Math.min(1, anteil));
  }
  function pegelJetzt() { return smeterAnteil(); }

  /* ================= LED-Feld (Gerät 1) ================================
     [LEDs STATT SENDEN] 20.11.2026
     RX  : leuchtet, solange der Empfänger läuft; blinkt, wenn kein Signal
           ankommt (Pegel unter der Rauschgrenze).
     TX  : beim Empfänger immer aus - Senden ist physikalisch nicht möglich.
     ALC : leuchtet, wenn der Pegel zu hoch ist (im roten Bereich des S-Meters).
     PWR : Gerät ist an.
     Die Werte kommen aus demselben Pegel wie das S-Meter, es gibt also keine
     zweite Wahrheit. */
  function ledsSetzen(i, g, w) {
    if (!w) { return; }
    var feld = w.querySelector(".w1-leds, .w2-leds");
    var teil = pegelJetzt();                 /* 0 .. 1 */
    var db = smeterDb();
    var laeuft = (typeof UI !== "undefined" && UI.getFrequency && UI.getFrequency() > 0);
    var signal = (db !== null && db > -95);
    if (feld) {
      function setz(name, an, blink) {
        var el = feld.querySelector('[data-led="' + name + '"]');
        if (!el) { return; }
        var alt = el.className.replace(/\s*\b(an|blink)\b/g, "");
        el.className = alt + (an ? " an" : "") + (blink ? " blink" : "");
      }
      setz("netz", true, false);               /* PWR - Gerät ist an */
      setz("rssi", laeuft, false);             /* RX  - Empfänger läuft */
      setz("sig", laeuft && signal, false);    /* SIG - Träger vorhanden */
      setz("ueber", teil > 0.90, false);       /* OVER - Pegel zu hoch */
    }
    var busy = w.querySelector('[data-led="busybar"]');
    if (busy) {
      busy.classList.toggle("an", laeuft);
      busy.classList.toggle("sig", laeuft && signal);
    }
    var tsPwr = w.querySelector("[data-ts-pwrled]");
    if (tsPwr) {
      var f2 = lichtObj(lichtIdLesen(1));
      var dim2 = !!w.querySelector(".ts-screen-slot.dim");
      var pCol = dim2 ? "#475569" : (f2.aus ? "#22c55e" : f2.hex);
      tsPwr.setAttribute("fill", pCol);
      tsPwr.style.filter = dim2 ? "none" : ("drop-shadow(0 0 3px " + pCol + ")");
    }
    var tsTx = w.querySelector("[data-ts-txled]");
    if (tsTx) {
      var tCol = !laeuft ? "#1f2937" : (signal ? "#4ade80" : "#15803d");
      tsTx.setAttribute("fill", tCol);
      tsTx.style.filter = (laeuft && signal) ? "drop-shadow(0 0 4px #22c55e)" : (laeuft ? "drop-shadow(0 0 2px #16a34a)" : "none");
    }
    var tsSpl = w.querySelector("[data-ts-splled]");
    if (tsSpl) {
      var fS = lichtObj(lichtIdLesen(1));
      var sAn = !!(g && g.splitAn);
      var sCol = sAn ? (fS.aus ? "#22c55e" : fS.hex) : "#1e293b";
      tsSpl.setAttribute("fill", sCol);
      tsSpl.style.filter = sAn ? ("drop-shadow(0 0 3px " + sCol + ")") : "none";
    }
    var tsRec = w.querySelector("[data-ts-recled]");
    if (tsRec) {
      var muted = (typeof volProzent === "function") ? (volProzent() === 0) : false;
      tsRec.setAttribute("fill", muted ? "#ef4444" : "#2b1616");
      tsRec.style.filter = muted ? "drop-shadow(0 0 2.5px #ef4444)" : "none";
    }
    var icPwr = w.querySelector("[data-ic-pwrled]");
    if (icPwr) {
      var f3 = lichtObj(lichtIdLesen(2));
      var dim3 = !!w.querySelector(".ic-screen-slot.dim");
      var pCol3 = dim3 ? "#475569" : (f3.aus ? "#22c55e" : f3.hex);
      icPwr.setAttribute("fill", pCol3);
      icPwr.style.filter = dim3 ? "none" : ("drop-shadow(0 0 3px " + pCol3 + ")");
    }
    var icTx = w.querySelector("[data-ic-txled]");
    if (icTx) {
      var tCol3 = !laeuft ? "#1f2937" : (signal ? "#4ade80" : "#16a34a");
      icTx.setAttribute("fill", tCol3);
      icTx.style.filter = (laeuft && signal) ? "drop-shadow(0 0 4px #22c55e)" : (laeuft ? "drop-shadow(0 0 2px #16a34a)" : "none");
    }
  }

  /* ================= Fenster-Handhabung ================================ */
  var FENSTER = [];

  function topLeistePruefen(w) {
    if (!w) { return; }
    var r = w.getBoundingClientRect();
    w.classList.toggle("fg-oben-eng", !!r && r.top < 24);
  }

  function gMeta(g) {
    var art = (g && g.art) ? g.art : "v1";
    if (art === "v1") {
      return { idx: 0, baseW: 800, minW: 460, w0: 617, h0: 242, shell: ".ft-shell", stage: ".ft-stage", skalaVar: "--ft-skala" };
    }
    if (art === "v3") {
      return { idx: 2, baseW: 720, minW: 440, w0: 620, h0: 282, shell: ".ic-shell", stage: ".ic-stage", skalaVar: "--w3-skala" };
    }
    return { idx: 1, baseW: 766, minW: 440, w0: 598, h0: 234, shell: ".ts-shell", stage: ".ts-stage", skalaVar: "--w2-skala" };
  }

  function fensterKlemmen(w, g) {
    if (!w || !g || !g.offen) { return; }
    var minW = gMeta(g).minW;
    var vw = window.innerWidth || 1600, vh = window.innerHeight || 980;
    var r = w.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) { return; }
    var maxFitW = Math.max(minW, vw - 16);
    if (r.width > maxFitW) {
      g.w = maxFitW;
      resizeAnwenden(w, g);
      r = w.getBoundingClientRect();
    }
    var maxFitH = Math.max(120, vh - 32);
    if (r.height > maxFitH && r.height > 0) {
      var nw = Math.max(minW, Math.floor(r.width * (maxFitH / r.height)));
      if (nw < r.width) {
        g.w = nw;
        resizeAnwenden(w, g);
        r = w.getBoundingClientRect();
      }
    }
    var minTop = (vh >= r.height + 28) ? 24 : 0;
    var nl = r.left, nt = r.top, ch = false;
    if (r.left < 0) { nl = 0; ch = true; }
    else if (r.right > vw) { nl = Math.max(0, vw - r.width); ch = true; }
    if (r.top < minTop) { nt = minTop; ch = true; }
    else if (r.bottom > vh) { nt = Math.max(minTop, vh - r.height); ch = true; }
    if (ch) {
      nl = Math.round(nl); nt = Math.round(nt);
      w.style.left = nl + "px";
      w.style.top = nt + "px";
      w.style.bottom = "auto";
      g.x = nl; g.y = nt;
    }
    topLeistePruefen(w);
  }

  function griffBinden(w, g) {
    var griff = w.querySelector("[data-griff]");
    if (!griff) { return; }
    var zieh = null;
    function onMove(e) {
      if (!zieh) { return; }
      var vw = window.innerWidth || 1600, vh = window.innerHeight || 980;
      var cr = w.getBoundingClientRect();
      var minTop = (vh >= cr.height + 28) ? 24 : 0;
      var maxX = Math.max(0, vw - cr.width);
      var maxY = Math.max(minTop, vh - cr.height);
      var x = Math.round(Math.max(0, Math.min(maxX, e.clientX - zieh.dx)));
      var y = Math.round(Math.max(minTop, Math.min(maxY, e.clientY - zieh.dy)));
      w.style.left = x + "px"; w.style.top = y + "px"; w.style.bottom = "auto";
      g.x = x; g.y = y;
      topLeistePruefen(w);
      if (e.cancelable && e.preventDefault) { e.preventDefault(); }
    }
    function onUp() {
      if (!zieh) { return; }
      zieh = null;
      griff.style.cursor = "grab";
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onUp, true);
      fensterKlemmen(w, g);
      sichern();
    }
    griff.addEventListener("pointerdown", function (e) {
      if (e && e.button && e.button !== 0) { return; }
      if (e.target.closest("button,input,select,textarea,a,canvas,.ft-scr-scope,.ts-scr-scope,.ic-scr-scope,.ft-pop,.ts-pop,.ic-pop,.ft-knob,.ts-knob,.ic-knob,[data-feld='dial'],[data-kwrap],[data-tsk],[data-ick],.ft-tpill,.ts-tpill,.ic-tpill,.ft-meter-wrap,.ts-meter-wrap,.ic-meter-wrap,.fg-eck,.fg-zu,.fg-wechsel")) { return; }
      var r = w.getBoundingClientRect();
      zieh = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      griff.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove, { capture: true, passive: false });
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      window.addEventListener("blur", onUp, true);
      e.preventDefault();
    });
  }

  function geraetWechsel(zielIdx) {
    var zIdx = (zielIdx === 2) ? 2 : ((zielIdx === 1) ? 1 : 0);
    Z.geraete.forEach(function (gg, k) {
      gg.offen = (k === zIdx);
      if (!gg.offen) {
        if (typeof dwStoppen === "function" && DW_STATE && DW_STATE.aktiv) { dwStoppen(k); }
        if (typeof scanStoppen === "function" && SCAN_STATE && SCAN_STATE.aktiv) { scanStoppen(k); }
      }
    });
    Z.aktiv = zIdx;
    sichern(); zeichnen();
    if (typeof window.dnxFunkKnopfAuffrischen === "function") { window.dnxFunkKnopfAuffrischen(); }
  }

  function resizeAnwenden(w, g) {
    if (!w || !g) { return; }
    var m = gMeta(g);
    var vwMax = Math.max(m.minW, (window.innerWidth || 1600) - 16);
    var maxW = Math.min(1500, vwMax);
    var curW = (isFinite(g.w) && g.w >= m.minW) ? Math.min(maxW, Math.round(g.w)) : Math.min(maxW, m.baseW);
    var skala = curW / m.baseW;
    var sh = w.querySelector(m.shell);
    var st = w.querySelector(m.stage);
    var baseH = m.baseW * m.h0 / m.w0;
    w.style.width = curW + "px";
    w.style.setProperty(m.skalaVar, skala.toFixed(4));
    if (sh) { sh.style.width = curW + "px"; sh.style.height = (baseH * skala).toFixed(2) + "px"; }
    if (st) { st.style.transform = "scale(" + skala.toFixed(4) + ")"; }
  }

  function resizeBinden(w, g) {
    if (!w || !g) { return; }
    var m = gMeta(g);
    var baseW = m.baseW;
    var minW = m.minW;
    var maxW = 1500;
    var zieht = null;

    function onResizeMove(ev) {
      if (!zieht) { return; }
      ev.stopPropagation();
      if (ev.cancelable && ev.preventDefault) { ev.preventDefault(); }
      var vw = window.innerWidth || 1600, vh = window.innerHeight || 980;
      var dx = ev.clientX - zieht.mx;
      var dy = ev.clientY - zieht.my;
      var vonLinks = zieht.pos.indexOf("l") >= 0;
      var vonOben = zieht.pos.indexOf("t") >= 0;
      var dW = vonLinks ? -dx : dx;
      var dH = (vonOben ? -dy : dy) * zieht.ratio;
      var delta = (Math.abs(dW) >= Math.abs(dH)) ? dW : dH;
      var nw = Math.max(minW, Math.min(zieht.effMaxW, Math.round(zieht.w + delta)));
      g.w = nw;
      resizeAnwenden(w, g);
      var nh = w.getBoundingClientRect().height;
      var minTop = (vh >= nh + 28) ? 24 : 0;
      var nx = vonLinks ? Math.round(zieht.anchorR - nw) : Math.round(zieht.anchorL);
      var ny = vonOben ? Math.round(zieht.anchorB - nh) : Math.round(zieht.anchorT);
      nx = Math.max(0, Math.min(Math.max(0, vw - nw), nx));
      ny = Math.max(minTop, Math.min(Math.max(minTop, vh - nh), ny));
      g.x = nx; g.y = ny;
      w.style.left = nx + "px";
      w.style.top = ny + "px";
      w.style.bottom = "auto";
      topLeistePruefen(w);
      if (typeof scopeZeichnen === "function") { scopeZeichnen(m.idx, w, true); }
      if (m.idx === 0 && typeof ftKnobsRedraw === "function") { ftKnobsRedraw(w); }
      if (m.idx === 1 && typeof tsKnobsRedraw === "function") { tsKnobsRedraw(w); }
      if (m.idx === 2 && typeof icKnobsRedraw === "function") { icKnobsRedraw(w); }
    }

    function onResizeEnd() {
      if (!zieht) { return; }
      zieht = null;
      window.removeEventListener("pointermove", onResizeMove, true);
      window.removeEventListener("pointerup", onResizeEnd, true);
      window.removeEventListener("pointercancel", onResizeEnd, true);
      window.removeEventListener("blur", onResizeEnd, true);
      fensterKlemmen(w, g);
      sichern();
    }

    Array.prototype.forEach.call(w.querySelectorAll(".fg-eck"), function (eck) {
      eck.addEventListener("pointerdown", function (ev) {
        if (ev && ev.button && ev.button !== 0) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        var r = w.getBoundingClientRect();
        var vw = window.innerWidth || 1600, vh = window.innerHeight || 980;
        var pos = eck.getAttribute("data-eck") || "br";
        var vonLinks = pos.indexOf("l") >= 0;
        var vonOben = pos.indexOf("t") >= 0;
        var ratio = r.width / Math.max(100, r.height);
        var minTop = (vh >= r.height + 28) ? 24 : 0;
        var availW = vonLinks ? r.right : (vw - r.left);
        var availH = vonOben ? Math.max(80, r.bottom - minTop) : (vh - r.top);
        var effMaxW = Math.max(minW, Math.min(maxW, vw - 16, Math.floor(Math.min(availW, availH * ratio))));
        zieht = {
          pos: pos,
          mx: ev.clientX,
          my: ev.clientY,
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          ratio: ratio,
          effMaxW: effMaxW,
          anchorL: r.left,
          anchorR: r.right,
          anchorT: r.top,
          anchorB: r.bottom
        };
        w.style.left = Math.round(r.left) + "px";
        w.style.top = Math.round(r.top) + "px";
        w.style.bottom = "auto";
        g.x = Math.round(r.left);
        g.y = Math.round(r.top);
        window.addEventListener("pointermove", onResizeMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onResizeEnd, true);
        window.addEventListener("pointercancel", onResizeEnd, true);
        window.addEventListener("blur", onResizeEnd, true);
      });
      eck.addEventListener("dblclick", function (ev) {
        ev.stopPropagation();
        g.w = Math.min(baseW, Math.max(minW, (window.innerWidth || 1600) - 16));
        resizeAnwenden(w, g);
        fensterKlemmen(w, g);
        sichern();
        if (typeof scopeZeichnen === "function") { scopeZeichnen(m.idx, w, true); }
        if (m.idx === 0 && typeof ftKnobsRedraw === "function") { ftKnobsRedraw(w); }
        if (m.idx === 1 && typeof tsKnobsRedraw === "function") { tsKnobsRedraw(w); }
        if (m.idx === 2 && typeof icKnobsRedraw === "function") { icKnobsRedraw(w); }
      });
    });

    var sw = w.querySelector("[data-wechsel]");
    if (sw) {
      sw.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      sw.addEventListener("click", function (ev) {
        ev.stopPropagation();
        fgKlick("rast");
        var zielAttr = parseInt(sw.getAttribute("data-wechsel") || "", 10);
        var ziel = isFinite(zielAttr) ? ((zielAttr - 1 + 3) % 3) : ((m.idx + 1) % 3);
        geraetWechsel(ziel);
      });
    }
  }

  function schliessenBinden(w, g) {
    var zu = w.querySelector("[data-zu]");
    if (!zu) { return; }
    zu.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
    zu.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    zu.addEventListener("click", function (ev) {
      ev.stopPropagation();
      fgKlick("taste");
      g.offen = false;
      var idxG = gMeta(g).idx;
      if (DW_STATE.aktiv) { dwStoppen(idxG); }
      if (SCAN_STATE.aktiv) { scanStoppen(idxG); }
      if (MENUE && MENUE.style.display === "block") { menuZeigen(false); }
      sichern(); zeichnen();
      if (typeof window.dnxFunkKnopfAuffrischen === "function") { window.dnxFunkKnopfAuffrischen(); }
    });
  }

  /* ================= Zustand =========================================== */
  /* [START IM EMPFANGSFENSTER] 20.11.2026
     Vorher standen die Geräte auf 14,195 und 7,035 MHz. Der Empfänger auf
     113 hört aber 29,976 - 32,024 MHz (Profil scan_30_32). Damit war jedes
     Drehen wirkungslos: "nicht verdrahtet". Jetzt starten beide dort, wo
     der Empfänger tatsächlich hinhört. Sobald der Empfänger etwas anderes
     empfängt, ziehen beide ohnehin nach (mitlaufen()). */
  var VORGABE = [
    { art: "v1", hz: 30500000, modus: "USB", schritt: 1000, x: null, y: null, w: 800, offen: true,  eingabe: "", sp: 3,  b: 30500000 },
    { art: "v2", hz: 29200000, modus: "CW",  schritt: 100,  x: null, y: null, w: 766, offen: true,  eingabe: "", sp: -1, b: 0 },
    { art: "v3", hz: 29200000, modus: "USB", schritt: 1000, x: null, y: null, w: 720, offen: false, eingabe: "", sp: -1, b: 0 }
  ];
  /* [EIN EMPFÄNGER, EIN BEDIENGERÄT] 20.11.2026
     Beide Geräte hängen am selben Empfänger - aber nur EINES kann ihn
     bedienen. Sonst schreiben sie sich gegenseitig die Frequenz.
     Deshalb gibt es eine aktive Kennung: drueckt man an einem Gerät eine
     Taste oder dreht daran, wird es das aktive. Nur das aktive Gerät
     stimmt ab; das andere folgt und zeigt dieselbe Frequenz an. */
  var Z = { geraete: [], aktiv: 0 };

  function lesen() {
    var roh = null;
    try { roh = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { }
    Z.geraete = VORGABE.map(function (v, i) {
      var g = (roh && roh.geraete && roh.geraete[i]) ? roh.geraete[i] : null;
      if (!g) { return JSON.parse(JSON.stringify(v)); }
      return {
        art: v.art,
        hz: (parseInt(g.hz, 10) > 0) ? parseInt(g.hz, 10) : v.hz,
        modus: String(g.modus || v.modus),
        schritt: (parseInt(g.schritt, 10) > 0) ? parseInt(g.schritt, 10) : v.schritt,
        x: isFinite(g.x) ? parseInt(g.x, 10) : v.x,
        y: (g.y === null || g.y === undefined) ? v.y : parseInt(g.y, 10),
        w: (isFinite(g.w) && parseInt(g.w, 10) >= 440 && parseInt(g.w, 10) <= 1500 && !(v.art === "v2" && parseInt(g.w, 10) === 740)) ? parseInt(g.w, 10) : v.w,
        offen: g.offen !== false,
        eingabe: "",
        sp: isFinite(g.sp) ? parseInt(g.sp, 10) : v.sp,
        b: (parseInt(g.b, 10) > 0) ? parseInt(g.b, 10) : v.b
      };
    });
    Z.aktiv = (roh && (roh.aktiv === 0 || roh.aktiv === 1 || roh.aktiv === 2)) ? roh.aktiv : 0;
  }

  function sichern() {
    try {
      localStorage.setItem(LS, JSON.stringify({
        aktiv: Z.aktiv,
        geraete: Z.geraete.map(function (g) {
          return { art: g.art, hz: g.hz, modus: g.modus, schritt: g.schritt,
                   x: g.x, y: g.y, w: g.w, offen: g.offen, sp: g.sp, b: g.b };
        })
      }));
    } catch (e) { }
  }

  /* ================= Abstimmen ========================================= */
  function abstimmen(i, hz, modus, meldung) {
    var g = Z.geraete[i];
    if (!g || !(hz >= 100000 && hz <= 13000000000)) { return false; }
    hz = Math.round(hz);

    var fz = fensterJetzt();
    if (SPERREN && fz && Math.abs(hz - fz.mitte) > fz.halb) {
      g.meldung = hzKurz(hz) + " MHz liegt außerhalb des Empfangsfensters";
      zeichnen();
      setTimeout(function () { g.meldung = ""; zeichnen(); }, 2800);
      return false;
    }

    var erfolg = empfangenSetzen(hz);
    if (erfolg === false) {
      /* Nicht so tun als ob: der Empfaenger steht woanders. */
      g.meldung = hzKurz(hz) + " MHz: Empfänger steht außerhalb";
      zeichnen();
      setTimeout(function () { g.meldung = ""; zeichnen(); }, 2800);
      return false;
    }
    g.hz = hz;
    if (modus) { g.modus = modus; empfangenModus(modus); }
    g.meldung = meldung || "";
    /* [BEIDE AM GLEICHEN EMPFÄNGER] Das bediente Gerät wird das aktive.
       Das andere zeigt dieselbe Frequenz und dieselbe Betriebsart - so
       sieht man an beiden Geräten, was der Empfänger tut. */
    Z.aktiv = i;
    Z.geraete.forEach(function (o, k) {
      if (k === i) { return; }
      o.hz = hz;
      if (modus) { o.modus = modus; }
    });
    sichern();
    zeichnen();
    return true;
  }

  /* ================= Tastenbeleuchtung & Regler-Sync (Gerät 1 & 2) ====== */
  var LICHT_LS = "dnx.fg.licht1";
  var LICHT_LS2 = "dnx.fg.licht2";
  var LICHT_LS3 = "dnx.fg.licht3";
  var LICHT_FARBEN = [
    { id: "blau",  name: "BLAU",  hex: "#4f94ff", hell: "#e2eeff", rgb: "79,148,255"  },
    { id: "cyan",  name: "CYAN",  hex: "#22d3ee", hell: "#d8f8ff", rgb: "34,211,238"  },
    { id: "amber", name: "AMBER", hex: "#f59e0b", hell: "#fef3c7", rgb: "245,158,11"  },
    { id: "gruen", name: "GRÜN",  hex: "#22c55e", hell: "#dcfce7", rgb: "34,197,94"   },
    { id: "rot",   name: "ROT",   hex: "#ef4444", hell: "#ffe4e6", rgb: "239,68,68"   },
    { id: "lila",  name: "LILA",  hex: "#a855f7", hell: "#f3e8ff", rgb: "168,85,247"  },
    { id: "weiss", name: "WEISS", hex: "#e2e8f0", hell: "#ffffff", rgb: "226,232,240" },
    { id: "aus",   name: "AUS",   hex: "#94a3b8", hell: "#cfd6e0", rgb: "0,0,0", aus: true }
  ];
  function lichtIdLesen(nr) {
    var key = (nr === 2) ? LICHT_LS3 : ((nr === 1) ? LICHT_LS2 : LICHT_LS);
    var def = (nr === 2) ? "weiss" : ((nr === 1) ? "cyan" : "blau");
    try {
      var id = localStorage.getItem(key) || def;
      for (var k = 0; k < LICHT_FARBEN.length; k++) {
        if (LICHT_FARBEN[k].id === id) { return id; }
      }
    } catch (e) { }
    return def;
  }
  function lichtObj(id) {
    for (var k = 0; k < LICHT_FARBEN.length; k++) {
      if (LICHT_FARBEN[k].id === id) { return LICHT_FARBEN[k]; }
    }
    return LICHT_FARBEN[0];
  }
  function lichtAnwenden(id, nr) {
    var idx = (nr === 2) ? 2 : ((nr === 1) ? 1 : 0);
    var key = (idx === 2) ? LICHT_LS3 : ((idx === 1) ? LICHT_LS2 : LICHT_LS);
    var f = lichtObj(id || lichtIdLesen(idx));
    try { localStorage.setItem(key, f.id); } catch (e) { }
    var w = FENSTER[idx] || document.getElementById("fg-geraet-" + idx);
    if (!w) { return f; }
    var pre = (idx === 2) ? "--w3" : ((idx === 1) ? "--w2" : "--w1");
    w.style.setProperty(pre + "-licht", f.hex);
    w.style.setProperty(pre + "-leg", f.hell);
    w.style.setProperty(pre + "-licht-rgb", f.rgb);
    w.style.setProperty(pre + "-leg-glow", f.aus ? "none" : ("0 0 6px rgba(" + f.rgb + ",.55)"));
    w.style.setProperty(pre + "-unterlicht", f.aus ? "0 2px 3px rgba(0,0,0,.68)" : ("0 2px 3px rgba(0,0,0,.68), 0 1px 6px rgba(" + f.rgb + ",.16)"));
    w.classList.toggle("w-licht-aus", !!f.aus);
    var pt = w.querySelector('[data-feld="lichtpunkt"]');
    if (pt) {
      pt.style.background = f.aus ? "#334155" : f.hex;
      pt.style.boxShadow = f.aus ? "inset 0 1px 1px rgba(0,0,0,.8)" : ("0 0 7px " + f.hex + ", inset 0 1px 1px rgba(255,255,255,.55)");
    }
    var nm = w.querySelector('[data-feld="lichtname"]');
    if (nm) { nm.textContent = f.name; }
    if (idx === 0) {
      w.classList.toggle("ft-lit", !f.aus);
      if (typeof ftKnobsRedraw === "function") { ftKnobsRedraw(w, f); }
    } else if (idx === 1) {
      w.classList.toggle("ts-lit", !f.aus);
      if (typeof tsKnobsRedraw === "function") { tsKnobsRedraw(w, f); }
      if (typeof ledsSetzen === "function" && Z && Z.geraete && Z.geraete[1]) { ledsSetzen(1, Z.geraete[1], w); }
    } else {
      w.classList.toggle("ic-lit", !f.aus);
      if (typeof icKnobsRedraw === "function") { icKnobsRedraw(w, f); }
      if (typeof ledsSetzen === "function" && Z && Z.geraete && Z.geraete[2]) { ledsSetzen(2, Z.geraete[2], w); }
    }
    return f;
  }

  /* Synchronisierte SQ / RF-GAIN Drehregler fuer beide Geraete */
  function drehKnopfDarstellen(el, val, min, max, lblEl, text) {
    if (!el) { return; }
    var v = Math.max(min, Math.min(max, val));
    var pct = (v - min) / Math.max(1, max - min);
    var deg = Math.round(pct * 270);
    var kn = el.querySelector(".fg-kn-kappe");
    if (kn) { kn.style.transform = "rotate(" + (-135 + pct * 270).toFixed(1) + "deg)"; }
    var arc = el.querySelector(".fg-kn-arc");
    if (arc) { arc.style.setProperty("--arc-deg", deg + "deg"); }
    if (lblEl) { lblEl.textContent = text; }
  }
  function reglerSyncAlle() {
    var sqV = (typeof MENU_STAND.squelch === "number") ? MENU_STAND.squelch : -150;
    var rfV = (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf;
    var sqTxt = (sqV <= -149) ? "AUS" : (sqV + " dB");
    var rfTxt = (_rfState.modus === "auto") ? "AGC" : (rfV + " dB");
    FENSTER.forEach(function (w, idx) {
      if (!w) { return; }
      if (idx === 0) { ftTelemetrieSync(w); } else if (idx === 1) { tsTelemetrieSync(w); } else { icTelemetrieSync(w); }
      drehKnopfDarstellen(w.querySelector('[data-feld="sqrad"]'), sqV, -150, 0, w.querySelector('[data-feld="sqwert"]'), sqTxt);
      drehKnopfDarstellen(w.querySelector('[data-feld="rfrad"]'), rfV, RF_MIN, RF_MAX, w.querySelector('[data-feld="rfwert"]'), rfTxt);
    });
    rfSyncMenue();
  }
  function kleinRadBinden(el, min, max, getVal, onSet) {
    if (!el) { return; }
    var zustand = { rest: 0, letzte: null, zieh: false };
    function setzen(v) {
      v = Math.max(min, Math.min(max, Math.round(v)));
      onSet(v);
      reglerSyncAlle();
    }
    el.addEventListener("pointerdown", function (e) {
      zustand.zieh = true; zustand.letzte = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (x) { }
      e.preventDefault(); e.stopPropagation();
    });
    el.addEventListener("pointermove", function (e) {
      if (!zustand.zieh) { return; }
      zustand.rest += (zustand.letzte - e.clientY);
      zustand.letzte = e.clientY;
      var step = (max - min) > 60 ? 3 : 1;
      while (Math.abs(zustand.rest) >= 3) {
        var r = zustand.rest > 0 ? 1 : -1;
        zustand.rest -= r * 3;
        setzen(getVal() + r * step);
      }
      e.stopPropagation();
    });
    el.addEventListener("pointerup", function (e) {
      zustand.zieh = false;
      try { el.releasePointerCapture(e.pointerId); } catch (x) { }
    });
    el.addEventListener("wheel", function (e) {
      e.preventDefault(); e.stopPropagation();
      var step = (max - min) > 60 ? 4 : 2;
      setzen(getVal() + (e.deltaY < 0 ? 1 : -1) * step);
    }, { passive: false });
  }
  function sqRfAufPultBinden(w) {
    if (!w) { return; }
    kleinRadBinden(w.querySelector('[data-feld="sqrad"]'), -150, 0,
      function () { return (typeof MENU_STAND.squelch === "number") ? MENU_STAND.squelch : -150; },
      function (v) { MENU_STAND.squelch = v; menuStandSichern(); fgKlick("dial"); squelchSetzen(v); }
    );
    kleinRadBinden(w.querySelector('[data-feld="rfrad"]'), RF_MIN, RF_MAX,
      function () { return (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf; },
      function (v) { fgKlick("dial"); rfAnwenden(v); }
    );
    reglerSyncAlle();
  }

  /* ---- Live-FFT-Puffer & 3D-Wasserfall-Anbindung ---- */
  var LIVE_FFT = { seq: 0, rows: [], maxRows: 120, fftSize: 0, hooked: false };
  function fftHookInstallieren() {
    if (LIVE_FFT.hooked && typeof window.waterfall_add === "function" && window.waterfall_add.__dnxFgHook) {
      return true;
    }
    if (typeof window.waterfall_add !== "function") { return false; }
    if (!window.waterfall_add.__dnxFgHook) {
      var orig = window.waterfall_add;
      var wrapped = function (data) {
        var res = orig.apply(this, arguments);
        try {
          if (data && data.length > 32) {
            LIVE_FFT.seq++;
            var hasP3 = !!(window.Plugins && Plugins.dnx_3dtool && Plugins.dnx_3dtool._hist && Plugins.dnx_3dtool._filled > 0);
            if (!hasP3) {
              var n = data.length;
              if (LIVE_FFT.fftSize !== n) { LIVE_FFT.rows = []; LIVE_FFT.fftSize = n; }
              var cp = new Int16Array(n);
              for (var k = 0; k < n; k++) {
                var vv = Math.round(data[k] * 100);
                cp[k] = vv < -32768 ? -32768 : (vv > 32767 ? 32767 : vv);
              }
              LIVE_FFT.rows.push(cp);
              if (LIVE_FFT.rows.length > LIVE_FFT.maxRows) { LIVE_FFT.rows.shift(); }
            }
          }
        } catch (e) { }
        return res;
      };
      wrapped.__dnxFgHook = true;
      if (orig.__dnx3d) { wrapped.__dnx3d = true; }
      window.waterfall_add = wrapped;
    }
    LIVE_FFT.hooked = true;
    return true;
  }

  var SCOPE_LS = "dnx.fg.scope1.v81";
  var SCOPE = {
    centered: false,
    spanHz: 0,
    expand: false,
    speedIdx: 0,
    mode: "3d",       /* "3d" (3DSS) | "std" (2D Normal) | "multi" (2D+3D Split) */
    mode2: "std",     /* Geraet 2: "std" (2D) | "3d" | "multi" */
    mode3: "std",     /* Geraet 3: "std" (2D) | "3d" | "multi" */
    palette: "ft710", /* "ft710" | "owrx" | "feuer" | "eis" | "gruen" */
    peakHold: true,
    grid3d: true,
    autoLevel: true,
    wfDown: true,     /* true = 0s oben/hinten -> fliesst ABWAERTS (wie OpenWebRX+ & dnx_3dtool) */
    lastPos: -1,
    lastSeq: -1,
    lastDraw: 0,
    lastDraw2: 0,
    lastDraw3: 0,
    zFloor: -78,
    zPeak: -50,
    lastVisKey: "",
    lastVisKey2: "",
    lastVisKey3: "",
    lastPos2: -1,
    lastSeq2: -1,
    lastPos3: -1,
    lastSeq3: -1
  };
  var SCOPE_SPANS = [0, 1000000, 500000, 200000, 100000, 50000];
  var SCOPE_SPEEDS = [
    { name: "FAST2", ms: 75,  step: 1 },
    { name: "FAST1", ms: 130, step: 2 },
    { name: "MID",   ms: 220, step: 3 },
    { name: "SLOW",  ms: 360, step: 5 }
  ];
  var SCOPE_PALETTES = {
    ft710: [
      [4,8,22],[8,16,52],[14,34,115],[24,62,195],[37,99,235],[79,70,229],[147,51,234],[220,38,38],[248,113,113],[254,226,226]
    ],
    feuer: [
      [8,4,4],[32,8,8],[96,12,12],[168,28,12],[224,78,12],[245,158,11],[251,211,77],[255,250,210]
    ],
    eis: [
      [3,12,24],[8,32,64],[14,74,120],[6,120,168],[34,195,230],[125,232,250],[224,247,255]
    ],
    gruen: [
      [4,16,8],[8,42,18],[14,88,36],[22,148,58],[34,197,94],[110,231,135],[220,252,231]
    ]
  };
  function scopeCfgLaden() {
    try {
      var o = JSON.parse(localStorage.getItem(SCOPE_LS) || "null");
      if (o) {
        SCOPE.centered = !!o.centered;
        if (typeof o.spanHz === "number" && SCOPE_SPANS.indexOf(o.spanHz) >= 0) { SCOPE.spanHz = o.spanHz; }
        SCOPE.expand = !!o.expand;
        if (typeof o.speedIdx === "number" && o.speedIdx >= 0 && o.speedIdx < SCOPE_SPEEDS.length) { SCOPE.speedIdx = o.speedIdx; }
        if (o.mode === "3d" || o.mode === "std" || o.mode === "multi") { SCOPE.mode = o.mode; }
        if (o.mode2 === "3d" || o.mode2 === "std" || o.mode2 === "multi") { SCOPE.mode2 = o.mode2; }
        if (o.mode3 === "3d" || o.mode3 === "std" || o.mode3 === "multi") { SCOPE.mode3 = o.mode3; }
        if (o.palette && (o.palette === "owrx" || SCOPE_PALETTES[o.palette])) { SCOPE.palette = o.palette; }
        if (typeof o.peakHold === "boolean") { SCOPE.peakHold = o.peakHold; }
        if (typeof o.grid3d === "boolean") { SCOPE.grid3d = o.grid3d; }
        if (typeof o.autoLevel === "boolean") { SCOPE.autoLevel = o.autoLevel; }
        if (typeof o.wfDown === "boolean") { SCOPE.wfDown = o.wfDown; }
      }
    } catch (e) { }
  }
  function scopeCfgSichern() {
    try {
      localStorage.setItem(SCOPE_LS, JSON.stringify({
        centered: SCOPE.centered,
        spanHz: SCOPE.spanHz,
        expand: SCOPE.expand,
        speedIdx: SCOPE.speedIdx,
        mode: SCOPE.mode,
        mode2: SCOPE.mode2,
        mode3: SCOPE.mode3,
        palette: SCOPE.palette,
        peakHold: SCOPE.peakHold,
        grid3d: SCOPE.grid3d,
        autoLevel: SCOPE.autoLevel,
        wfDown: SCOPE.wfDown
      }));
    } catch (e) { }
  }

  /* 3D-Modus mit Server (Plugins.dnx_3dtool) abgleichen - nur 2D (std) oder 3D (3d) */
  function dnx3dModusLesen() {
    try {
      var p = window.Plugins && Plugins.dnx_3dtool;
      if (p && p.settings && p.settings.viewMode) {
        var vm = p.settings.viewMode;
        return (vm === "3d" || vm === "both") ? "3d" : "std";
      }
    } catch (e) { }
    try {
      var o = JSON.parse(localStorage.getItem("dnx_3dtool") || "{}") || {};
      if (o.viewMode === "3d" || o.viewMode === "both" || o.enabled === true) { return "3d"; }
    } catch (e2) { }
    return "std";
  }
  function dnx3dModusSetzen(mode) {
    var srvMode = (mode === "3d") ? "3d" : "std";
    SCOPE.mode = (mode === "multi") ? "multi" : srvMode;
    scopeCfgSichern();
    mode = srvMode;
    try {
      var o = {};
      try { o = JSON.parse(localStorage.getItem("dnx_3dtool") || "{}") || {}; } catch (e) { o = {}; }
      o.viewMode = mode;
      o.enabled = (mode === "3d");
      o.layoutVersion = 2;
      localStorage.setItem("dnx_3dtool", JSON.stringify(o));
    } catch (e1) { }
    var angewandt = false;
    try {
      var p = window.Plugins && Plugins.dnx_3dtool;
      if (p && typeof p.setMode === "function" && p.settings) {
        p.setMode(mode, false);
        if (typeof p._layoutMode === "function") { p._layoutMode(); }
        angewandt = true;
      }
    } catch (e2) { }
    if (!angewandt) {
      var tries = 0;
      var tm = setInterval(function () {
        tries++;
        try {
          var p2 = window.Plugins && Plugins.dnx_3dtool;
          if (p2 && typeof p2.setMode === "function" && p2.settings) {
            p2.setMode(mode, false);
            if (typeof p2._layoutMode === "function") { p2._layoutMode(); }
            clearInterval(tm);
          } else if (tries > 40) { clearInterval(tm); }
        } catch (e3) { clearInterval(tm); }
      }, 250);
    }
    return true;
  }

  function scopeSpanText(spanHz) {
    if (!spanHz) { return "FULL"; }
    if (spanHz >= 1000000) { return (spanHz / 1000000) + "MHz"; }
    return Math.round(spanHz / 1000) + "kHz";
  }

  function scopeFensterBerechnen(g) {
    var cf = (typeof window.center_freq === "number" && window.center_freq > 0) ? window.center_freq : 0;
    var bw = (typeof window.bandwidth === "number" && window.bandwidth > 0) ? window.bandwidth : 0;
    var rfStart = (cf && bw) ? (cf - bw / 2) : 0;
    var rfEnd = (cf && bw) ? (cf + bw / 2) : 0;
    var vis = null;
    try {
      if (typeof window.get_visible_freq_range === "function") {
        var v = window.get_visible_freq_range();
        if (v && v.end > v.start) { vis = v; }
      }
    } catch (e) { }
    var f0 = 0, f1 = 0;
    if (!SCOPE.centered && SCOPE.spanHz === 0) {
      if (vis) { f0 = vis.start; f1 = vis.end; }
      else if (rfEnd > rfStart) { f0 = rfStart; f1 = rfEnd; }
      else { f0 = (g.hz || 30500000) - 250000; f1 = (g.hz || 30500000) + 250000; }
    } else {
      var sp = SCOPE.spanHz > 0 ? SCOPE.spanHz : (vis ? Math.min(vis.end - vis.start, 500000) : 500000);
      var c = g.hz || (vis ? (vis.start + vis.end) / 2 : cf) || 30500000;
      f0 = c - sp / 2;
      f1 = c + sp / 2;
    }
    return { f0: f0, f1: f1, bw: Math.max(1, f1 - f0), rfStart: rfStart, rfBw: bw };
  }

  function scopeZeilenQuelle() {
    var p = window.Plugins && Plugins.dnx_3dtool;
    if (p && p._hist && p._filled > 0 && p._fftSize > 0 && p._rows > 0) {
      return { kind: "p3", hist: p._hist, rows: p._rows, pos: p._pos, filled: p._filled, fftSize: p._fftSize };
    }
    if (LIVE_FFT.rows.length > 0 && LIVE_FFT.fftSize > 0) {
      return { kind: "bak", arr: LIVE_FFT.rows, filled: LIVE_FFT.rows.length, fftSize: LIVE_FFT.fftSize };
    }
    return null;
  }

  function scopeZeileHolen(src, ageIdx) {
    if (!src || ageIdx >= src.filled) { return null; }
    if (src.kind === "p3") {
      var rIdx = (src.pos - 1 - ageIdx + src.rows * 4) % src.rows;
      return { buf: src.hist, off: rIdx * src.fftSize, len: src.fftSize };
    }
    var idx = src.arr.length - 1 - ageIdx;
    if (idx < 0) { return null; }
    return { buf: src.arr[idx], off: 0, len: src.fftSize };
  }

  function scopeDezimiere(row, rfStart, rfBw, f0, f1, cols, outMax, outAvg) {
    if (!row || !row.buf || !(rfBw > 0) || !(f1 > f0)) {
      for (var z = 0; z < cols; z++) { outMax[z] = -120; if (outAvg) { outAvg[z] = -120; } }
      return;
    }
    var n = row.len, off = row.off, buf = row.buf;
    var span = f1 - f0;
    for (var x = 0; x < cols; x++) {
      var fx0 = f0 + (x / cols) * span;
      var fx1 = f0 + ((x + 1) / cols) * span;
      var b0 = Math.floor(((fx0 - rfStart) / rfBw) * n);
      var b1 = Math.ceil(((fx1 - rfStart) / rfBw) * n);
      if (b1 <= b0) { b1 = b0 + 1; }
      if (b1 <= 0 || b0 >= n) {
        outMax[x] = -135; if (outAvg) { outAvg[x] = -135; } continue;
      }
      if (b0 < 0) { b0 = 0; }
      if (b1 > n) { b1 = n; }
      var mx = -999, sm = 0, cnt = 0;
      var step = (b1 - b0) > 64 ? Math.floor((b1 - b0) / 32) : 1;
      for (var b = b0; b < b1; b += step) {
        var v = buf[off + b] * 0.01;
        if (v > mx) { mx = v; }
        sm += v; cnt++;
      }
      outMax[x] = cnt ? mx : -135;
      if (outAvg) { outAvg[x] = cnt ? (sm / cnt) : -135; }
    }
  }

  var FALLBACK_FARBEN = (function () {
    var arr = [], i, t, r, g, b;
    for (i = 0; i < 256; i++) {
      t = i / 255;
      if (t < 0.25) { r = 10; g = Math.round(20 + t * 4 * 80); b = Math.round(70 + t * 4 * 150); }
      else if (t < 0.55) { var u = (t - 0.25) / 0.3; r = Math.round(10 + u * 30); g = Math.round(100 + u * 135); b = Math.round(220 + u * 35); }
      else if (t < 0.80) { var v = (t - 0.55) / 0.25; r = Math.round(40 + v * 215); g = Math.round(235 - v * 25); b = Math.round(255 - v * 200); }
      else { var w = (t - 0.80) / 0.20; r = 255; g = Math.round(210 - w * 165); b = Math.round(55 + w * 150); }
      arr.push([r, g, b]);
    }
    return arr;
  })();

  function wfFarbenUndPegel() {
    var colors = FALLBACK_FARBEN, lvMin = -110, lvMax = -20;
    try {
      if (window.Waterfall) {
        if (Waterfall.colors && Waterfall.colors.length >= 16) { colors = Waterfall.colors; }
        var r = (typeof Waterfall.getRange === "function") ? Waterfall.getRange() : Waterfall.levels;
        if (r && isFinite(r.min) && isFinite(r.max) && r.max > r.min) { lvMin = r.min; lvMax = r.max; }
      }
    } catch (e) { }
    if (SCOPE.palette !== "owrx" && SCOPE_PALETTES[SCOPE.palette]) {
      var stops = SCOPE_PALETTES[SCOPE.palette];
      var tbl = [];
      for (var s = 0; s < 64; s++) {
        var t = (s / 63) * (stops.length - 1);
        var i0 = Math.floor(t), i1 = Math.min(stops.length - 1, i0 + 1), f = t - i0;
        tbl.push([
          Math.round(stops[i0][0] + (stops[i1][0] - stops[i0][0]) * f),
          Math.round(stops[i0][1] + (stops[i1][1] - stops[i0][1]) * f),
          Math.round(stops[i0][2] + (stops[i1][2] - stops[i0][2]) * f)
        ]);
      }
      colors = tbl;
    }
    return { colors: colors, min: lvMin, max: lvMax };
  }

  function farbeBeiT(colors, t) {
    if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
    var idx = Math.min(colors.length - 1, Math.max(0, Math.round(t * (colors.length - 1))));
    return colors[idx] || [0, 0, 0];
  }

  function demodBandInfo() {
    try {
      if (window.UI && typeof UI.getDemodulator === "function") {
        var d = UI.getDemodulator();
        if (d) {
          return {
            lo: (typeof d.low_cut === "number") ? d.low_cut : -2400,
            hi: (typeof d.high_cut === "number") ? d.high_cut : 2400
          };
        }
      }
    } catch (e) { }
    return { lo: -2400, hi: 2400 };
  }

  function scopeSkalaAktualisieren(w, g, win, idx) {
    var sf0 = w.querySelector('[data-feld="sf0"]');
    var sf1 = w.querySelector('[data-feld="sf1"]');
    var sfm = w.querySelector('[data-feld="scopefreq"]');
    var sf3 = w.querySelector('[data-feld="sf3"]');
    var sf4 = w.querySelector('[data-feld="sf4"]');
    var info = w.querySelector('[data-feld="scopeinfo"]');
    var curM = (idx === 2) ? (SCOPE.mode3 || "std") : ((idx === 1) ? (SCOPE.mode2 || "std") : SCOPE.mode);
    var mTxt = (curM === "3d" ? "3DSS" : (curM === "multi" ? "MULTI" : "2D"));
    var spName = SCOPE_SPEEDS[SCOPE.speedIdx].name;
    var spanLabel = (!SCOPE.centered && SCOPE.spanHz === 0) ? "FULL" : scopeSpanText(SCOPE.spanHz || 500000);
    if (info) {
      info.innerHTML = '<b>' + mTxt + '</b> · ' + spName + ' · ' + spanLabel + ' ▾';
    }
    if (SCOPE.centered || SCOPE.spanHz > 0) {
      var half = win.bw / 2;
      var fmtOff = function (hz) {
        var sg = hz < 0 ? "-" : "+";
        var a = Math.abs(hz);
        if (a >= 1000000) { return sg + (a / 1e6).toFixed(2).replace(/\.00$/, "") + "M"; }
        return sg + Math.round(a / 1000) + "k";
      };
      if (sf0) { sf0.textContent = fmtOff(-half); }
      if (sf1) { sf1.textContent = fmtOff(-half / 2); }
      if (sfm) { sfm.textContent = hzText(g.hz || (win.f0 + half)); }
      if (sf3) { sf3.textContent = fmtOff(half / 2); }
      if (sf4) { sf4.textContent = fmtOff(half); }
    } else {
      var fmtM = function (hz) { return (hz / 1e6).toFixed(2) + "M"; };
      if (sf0) { sf0.textContent = fmtM(win.f0); }
      if (sf1) { sf1.textContent = fmtM(win.f0 + win.bw * 0.25); }
      if (sfm) { sfm.textContent = hzText(win.f0 + win.bw * 0.5); }
      if (sf3) { sf3.textContent = fmtM(win.f0 + win.bw * 0.75); }
      if (sf4) { sf4.textContent = fmtM(win.f1); }
    }
    if (idx === 0) {
      var sk = w.querySelector(".ft-softkeys");
      if (sk) {
        var bCenter = sk.querySelector('[data-scope="center"]');
        var b3d = sk.querySelector('[data-scope="3dss"]');
        var bMulti = sk.querySelector('[data-scope="multi"]');
        var bExp = sk.querySelector('[data-scope="expand"]');
        var bSpan = sk.querySelector('[data-scope="span"]');
        var bSpeed = sk.querySelector('[data-scope="speed"]');
        if (bCenter) { bCenter.classList.toggle("an", !!SCOPE.centered); }
        if (b3d) {
          b3d.textContent = (SCOPE.mode === "std") ? "2D" : "3DSS";
          b3d.classList.toggle("an", SCOPE.mode === "3d" || SCOPE.mode === "std");
        }
        if (bMulti) { bMulti.classList.toggle("an", SCOPE.mode === "multi"); }
        if (bExp) { bExp.classList.toggle("an", !!SCOPE.expand); }
        if (bSpan) { bSpan.classList.toggle("an", SCOPE.spanHz > 0); }
        if (bSpeed) { bSpeed.classList.toggle("an", SCOPE.speedIdx > 0); }
      }
    } else if (idx === 1) {
      var sk2 = w.querySelector(".ts-softkeys");
      if (sk2) {
        var c2 = sk2.querySelector('[data-ts-sk="center"]');
        var sm2 = sk2.querySelector('[data-ts-sk="smode"]');
        var sp2 = sk2.querySelector('[data-ts-sk="span"]');
        var sd2 = sk2.querySelector('[data-ts-sk="speed"]');
        var ex2 = sk2.querySelector('[data-ts-sk="expand"]');
        if (c2) { c2.classList.toggle("an", !!SCOPE.centered); }
        if (sm2) {
          var m2 = SCOPE.mode2 || "std";
          sm2.textContent = (m2 === "3d") ? "F2 3D" : ((m2 === "multi") ? "F2 MLT" : "F2 2D");
          sm2.classList.toggle("an", m2 !== "std");
        }
        if (sp2) { sp2.classList.toggle("an", SCOPE.spanHz > 0); }
        if (sd2) { sd2.classList.toggle("an", SCOPE.speedIdx > 0); }
        if (ex2) { ex2.classList.toggle("an", !!SCOPE.expand); }
      }
    } else {
      var sk3 = w.querySelector(".ic-softkeys");
      if (sk3) {
        var c3 = sk3.querySelector('[data-ic-sk="center"]');
        var sm3 = sk3.querySelector('[data-ic-sk="smode"]');
        var sp3 = sk3.querySelector('[data-ic-sk="span"]');
        var sd3 = sk3.querySelector('[data-ic-sk="speed"]');
        var ex3 = sk3.querySelector('[data-ic-sk="expand"]');
        if (c3) { c3.classList.toggle("an", !!SCOPE.centered); }
        if (sm3) {
          var m3 = SCOPE.mode3 || "std";
          sm3.textContent = (m3 === "3d") ? "3DSS" : ((m3 === "multi") ? "MULTI" : "2D");
          sm3.classList.toggle("an", m3 !== "std");
        }
        if (sp3) { sp3.classList.toggle("an", SCOPE.spanHz > 0); }
        if (sd3) { sd3.classList.toggle("an", SCOPE.speedIdx > 0); }
        if (ex3) { ex3.classList.toggle("an", !!SCOPE.expand); }
      }
    }
  }

  function scopeAdaptiveGrenzen(bufMax, cols) {
    if (!SCOPE.autoLevel) { return { floor: -102, peak: -28 }; }
    var vals = [];
    for (var i = 0; i < cols; i += 2) {
      if (bufMax[i] > -130) { vals.push(bufMax[i]); }
    }
    if (!vals.length) { return { floor: -85, peak: -45 }; }
    vals.sort(function (a, b) { return a - b; });
    var p20 = vals[Math.floor(vals.length * 0.20)];
    var p99 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.99))];
    SCOPE.zFloor = SCOPE.zFloor * 0.78 + p20 * 0.22;
    SCOPE.zPeak = SCOPE.zPeak * 0.72 + Math.max(p99, p20 + 18) * 0.28;
    return { floor: SCOPE.zFloor - 2, peak: Math.max(SCOPE.zFloor + 20, SCOPE.zPeak + 2) };
  }

  /* 2D Spektrum + Wasserfall mit interner dB-Skala, Frequenzraster & Farbskala */
  function scopeZeichne2D(ctx, W, H, topY, src, win, wf, g, step, cols) {
    var plotW = Math.max(120, W - 7); /* rechts 7px fuer Wasserfall-Pegel-Farbskala */
    var spH = Math.max(22, Math.round(H * 0.36));
    var wfY = topY + spH;
    var wfH = Math.max(16, H - spH);
    var outMax = new Float32Array(cols);
    var outAvg = new Float32Array(cols);

    var r0 = scopeZeileHolen(src, 0);
    scopeDezimiere(r0, win.rfStart, win.rfBw, win.f0, win.f1, cols, outMax, outAvg);
    var lim = scopeAdaptiveGrenzen(outMax, cols);
    var spanDb = Math.max(12, lim.peak - lim.floor);

    /* Spektrum-Hintergrund & Raster mit dB-Skala */
    ctx.fillStyle = "#060e1f";
    ctx.fillRect(0, topY, plotW, spH);

    ctx.font = "700 8.5px ui-monospace,monospace";
    ctx.textBaseline = "middle";
    var dbSteps = (spH <= 32) ? [0.26, 0.80] : [0.22, 0.55, 0.88];
    for (var s = 0; s < dbSteps.length; s++) {
      var frac = dbSteps[s];
      var dbValG = Math.round(lim.floor + frac * spanDb);
      var yy = Math.round(topY + spH - 2 - frac * (spH - 6)) + 0.5;
      ctx.strokeStyle = "rgba(120,170,235,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(40, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillStyle = "rgba(219,234,254,0.92)";
      ctx.textAlign = "left";
      ctx.fillText(dbValG + " dB", 4, yy);
    }
    for (var gx = 1; gx < 4; gx++) {
      var xx = Math.round((gx / 4) * plotW) + 0.5;
      ctx.strokeStyle = "rgba(120,170,235,0.22)";
      ctx.beginPath(); ctx.moveTo(xx, topY); ctx.lineTo(xx, topY + spH); ctx.stroke();
    }

    /* Peak-Hold-Huellkurve aktualisieren */
    var pkKey = win.f0.toFixed(0) + "|" + win.f1.toFixed(0) + "|" + cols;
    if (!scopeZeichne2D._pkBuf || scopeZeichne2D._pkKey !== pkKey || scopeZeichne2D._pkBuf.length !== cols) {
      scopeZeichne2D._pkBuf = new Float32Array(outMax);
      scopeZeichne2D._pkKey = pkKey;
    } else {
      var pkB = scopeZeichne2D._pkBuf;
      for (var pxI = 0; pxI < cols; pxI++) {
        var curV = outMax[pxI];
        if (curV >= pkB[pxI]) { pkB[pxI] = curV; }
        else { pkB[pxI] = Math.max(curV, pkB[pxI] - 0.35); }
      }
    }

    /* Live-Spektrumkurve */
    ctx.beginPath();
    var x, peakVal = -999;
    for (x = 0; x < cols; x++) {
      if (outMax[x] > peakVal) { peakVal = outMax[x]; }
      var norm = Math.max(0, Math.min(1, (outMax[x] - lim.floor) / spanDb));
      var px = (x / (cols - 1)) * plotW;
      var py = topY + spH - 2 - norm * (spH - 6);
      if (x === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    var grad = ctx.createLinearGradient(0, topY, 0, topY + spH);
    grad.addColorStop(0, "rgba(56,189,248,0.58)");
    grad.addColorStop(1, "rgba(15,35,68,0.10)");
    ctx.save();
    ctx.lineTo(plotW, topY + spH);
    ctx.lineTo(0, topY + spH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* Goldene Peak-Hold-Spur */
    if (SCOPE.peakHold && scopeZeichne2D._pkBuf) {
      ctx.beginPath();
      for (x = 0; x < cols; x++) {
        var pNorm = Math.max(0, Math.min(1, (scopeZeichne2D._pkBuf[x] - lim.floor) / spanDb));
        var pkX = (x / (cols - 1)) * plotW;
        var pkY = topY + spH - 2 - pNorm * (spH - 6);
        if (x === 0) { ctx.moveTo(pkX, pkY); } else { ctx.lineTo(pkX, pkY); }
      }
      ctx.strokeStyle = "rgba(251,191,36,0.72)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    if (peakVal > -130) {
      ctx.fillStyle = "rgba(186,230,253,0.9)";
      ctx.textAlign = "right";
      ctx.fillText("PK " + peakVal.toFixed(0) + "dB", plotW - 3, topY + 6);
      ctx.textAlign = "start";
    }

    /* Live-2D-Wasserfall (Peak-Hold + OpenWebRX-Farbskala) */
    var lvSpan = Math.max(1, wf.max - wf.min);
    var imgW = cols;
    var maxHist = Math.min(wfH, Math.floor((src.filled - 1) / step) + 1);
    if (maxHist > 0) {
      if (!scopeZeichne2D._tmp || scopeZeichne2D._tmp.width !== imgW || scopeZeichne2D._tmp.height !== wfH) {
        scopeZeichne2D._tmp = document.createElement("canvas");
        scopeZeichne2D._tmp.width = imgW;
        scopeZeichne2D._tmp.height = wfH;
      }
      var tc = scopeZeichne2D._tmp;
      var tctx = tc.getContext("2d");
      var img = tctx.createImageData(imgW, wfH);
      var d = img.data;
      for (var y = 0; y < wfH; y++) {
        var sy = SCOPE.wfDown ? y : (wfH - 1 - y);
        var age = sy * step;
        var row = (age < src.filled) ? scopeZeileHolen(src, age) : null;
        if (row) {
          scopeDezimiere(row, win.rfStart, win.rfBw, win.f0, win.f1, imgW, outMax, outAvg);
        }
        var rowOff = y * imgW * 4;
        for (x = 0; x < imgW; x++) {
          var p = rowOff + x * 4;
          if (!row || outMax[x] < -130) {
            d[p] = 5; d[p + 1] = 11; d[p + 2] = 24; d[p + 3] = 255;
          } else {
            var dbVal = outMax[x];
            var tCol = (dbVal - wf.min) / lvSpan;
            var rgb = farbeBeiT(wf.colors, tCol);
            d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255;
          }
        }
      }
      tctx.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tc, 0, wfY, plotW, wfH);
      ctx.restore();
    } else {
      ctx.fillStyle = "#060e1f";
      ctx.fillRect(0, wfY, plotW, wfH);
    }

    /* Vertikale Rasterlinien & Skalenkerben im Wasserfall */
    for (gx = 1; gx < 4; gx++) {
      var vxG = Math.round((gx / 4) * plotW) + 0.5;
      ctx.strokeStyle = "rgba(180,210,255,0.16)";
      ctx.beginPath(); ctx.moveTo(vxG, wfY); ctx.lineTo(vxG, wfY + wfH); ctx.stroke();
    }
    ctx.fillStyle = "rgba(186,215,250,0.48)";
    ctx.fillRect(0, wfY, plotW, 1);
    for (var tk = 1; tk < 8; tk++) {
      var tx = Math.round((tk / 8) * plotW) + 0.5;
      ctx.fillStyle = (tk % 2 === 0) ? "rgba(226,232,240,0.75)" : "rgba(148,163,184,0.45)";
      ctx.fillRect(tx, wfY - (tk % 2 === 0 ? 3 : 2), 1, tk % 2 === 0 ? 5 : 3);
    }

    /* Rechte 6px Farbskala-Legende (dB -> Farbe) */
    var barX = plotW + 1, barW = Math.max(4, W - barX);
    for (var by = 0; by < H; by++) {
      var tb = 1 - (by / Math.max(1, H - 1));
      var cRgb = farbeBeiT(wf.colors, tb);
      ctx.fillStyle = "rgb(" + cRgb[0] + "," + cRgb[1] + "," + cRgb[2] + ")";
      ctx.fillRect(barX, topY + by, barW, 1);
    }

    /* VFO-Cursor + Filter-Durchlassbereich */
    if (g.hz >= win.f0 && g.hz <= win.f1) {
      var uVfo = (g.hz - win.f0) / win.bw;
      var vx = uVfo * plotW;
      var dm = demodBandInfo();
      var xLo = Math.max(0, Math.min(plotW, ((g.hz + dm.lo - win.f0) / win.bw) * plotW));
      var xHi = Math.max(0, Math.min(plotW, ((g.hz + dm.hi - win.f0) / win.bw) * plotW));
      if (xHi - xLo >= 2) {
        ctx.fillStyle = "rgba(239,68,68,0.18)";
        ctx.fillRect(xLo, topY, xHi - xLo, H);
      }
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(Math.round(vx) - 0.5, topY, 1.5, H);
      ctx.beginPath();
      ctx.moveTo(vx, topY + 6);
      ctx.lineTo(vx - 4, topY);
      ctx.lineTo(vx + 4, topY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textBaseline = "alphabetic";
  }

  /* 3DSS Perspektiv-Wasserfall mit interner dB-Hoehenskala, Frequenz- & Zeitskala */
  function scopeZeichne3D(ctx, W, H, topY, src, win, wf, g, step, cols) {
    ctx.fillStyle = "#060d1c";
    ctx.fillRect(0, topY, W, H);

    var nSlices = Math.max(8, Math.min(26, Math.floor((src.filled - 1) / step) + 1));
    if (nSlices < 2) { nSlices = Math.min(26, src.filled); }
    var padL = (W < 180) ? 14 : 24, padR = (W < 180) ? 14 : 24;
    var spanW = Math.max(120, W - padL - padR);
    var yFront = topY + H * 0.90;
    var yBack = topY + H * 0.38;
    var xShrink = 0.28;
    function projX(u, d) {
      var sc = 1.0 - xShrink * d;
      var left = padL + spanW * (1.0 - sc) * 0.5;
      return left + u * spanW * sc;
    }
    function projY(d) {
      return yFront - (yFront - yBack) * Math.pow(d, 0.86);
    }

    var outMax = new Float32Array(cols);
    var outAvg = new Float32Array(cols);
    var rLatest = scopeZeileHolen(src, 0);
    scopeDezimiere(rLatest, win.rfStart, win.rfBw, win.f0, win.f1, cols, outMax, outAvg);
    var lim = scopeAdaptiveGrenzen(outMax, cols);
    var hSpan = Math.max(12, lim.peak - lim.floor);
    var wfSpan = Math.max(1, wf.max - wf.min);
    var maxLift = H * 0.38;

    /* Perspektivischer 3D-Skalenkaefig (schaltbar ueber WF-Optionen) */
    if (SCOPE.grid3d) {
    ctx.strokeStyle = "rgba(105,165,245,0.28)";
    ctx.lineWidth = 1;
    var gi;
    for (gi = 0; gi <= 4; gi++) {
      var gu = gi / 4;
      ctx.beginPath();
      ctx.moveTo(projX(gu, 0), projY(0));
      ctx.lineTo(projX(gu, 1), projY(1));
      ctx.stroke();
      /* Kerben entlang der vorderen Frequenzkante */
      var fx = projX(gu, 0), fy = projY(0);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + 3); ctx.stroke();
    }
    for (gi = 0; gi <= 4; gi++) {
      var gd = gi / 4;
      var gy = projY(gd);
      ctx.beginPath();
      ctx.moveTo(projX(0, gd), gy);
      ctx.lineTo(projX(1, gd), gy);
      ctx.stroke();
    }

    /* Linke vertikale dB-Skala (Z-Achse an der linken Perspektivkante) */
    var zScaleX = projX(0, 1);
    var zScaleBase = projY(1);
    var zLiftBack = maxLift * (1.0 - 0.34);
    ctx.strokeStyle = "rgba(147,197,253,0.45)";
    ctx.beginPath();
    ctx.moveTo(zScaleX, zScaleBase);
    ctx.lineTo(zScaleX, zScaleBase - zLiftBack);
    ctx.moveTo(projX(0, 0), projY(0));
    ctx.lineTo(projX(0, 0), projY(0) - maxLift);
    ctx.stroke();

    ctx.font = "700 8.5px ui-monospace,monospace";
    ctx.textBaseline = "middle";
    var zTics = [0, 0.5, 1.0];
    for (gi = 0; gi < zTics.length; gi++) {
      var zt = zTics[gi];
      var yZBack = zScaleBase - zt * zLiftBack;
      var yZFront = projY(0) - zt * maxLift;
      ctx.strokeStyle = "rgba(147,197,253,0.24)";
      ctx.beginPath();
      ctx.moveTo(projX(0, 0), yZFront);
      ctx.lineTo(zScaleX, yZBack);
      ctx.lineTo(projX(1, 1), yZBack);
      ctx.stroke();
      var zDb = Math.round(lim.floor + zt * hSpan);
      ctx.fillStyle = "rgba(219,234,254,0.92)";
      ctx.textAlign = "right";
      ctx.fillText(zDb + "", padL - 3, yZFront);
    }
    ctx.fillStyle = "rgba(147,197,253,0.85)";
    ctx.textAlign = "right";
    ctx.fillText("dB", padL - 3, topY + 7);

    /* Zeit-Tiefe rechts ("0s" oben/hinten -> "-10s" unten/vorne bei Abwaertsfluss) */
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(148,197,255,0.78)";
    ctx.fillText(SCOPE.wfDown ? "-10s" : "0s", projX(1, 0) + 3, projY(0));
    ctx.fillText(SCOPE.wfDown ? "0s" : "-10s", projX(1, 1) + 3, projY(1));

    }
    /* Back-to-Front Signalgebirge */
    var k;
    for (k = nSlices - 1; k >= 0; k--) {
      var ageIdx = SCOPE.wfDown ? (nSlices - 1 - k) : k;
      var age = Math.min(src.filled - 1, ageIdx * step);
      var row = scopeZeileHolen(src, age);
      if (!row) { continue; }
      scopeDezimiere(row, win.rfStart, win.rfBw, win.f0, win.f1, cols, outMax, outAvg);
      var d = (nSlices > 1) ? (k / (nSlices - 1)) : 0;
      var ageNorm = (nSlices > 1) ? (ageIdx / (nSlices - 1)) : 0;
      var base = projY(d);
      var liftScale = maxLift * (1.0 - 0.34 * d);

      ctx.beginPath();
      ctx.moveTo(projX(0, d), base + 2);
      var x;
      for (x = 0; x < cols; x++) {
        var norm = Math.max(0, Math.min(1, (outMax[x] - lim.floor) / hSpan));
        var px = projX(x / (cols - 1), d);
        var py = base - norm * liftScale;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(projX(1, d), base + 2);
      ctx.closePath();
      ctx.fillStyle = "rgba(6, 13, 28, " + (0.88 - 0.16 * d).toFixed(2) + ")";
      ctx.fill();

      var fade = 1.0 - 0.36 * ageNorm;
      ctx.lineWidth = (ageIdx === 0) ? 1.55 : (1.15 - 0.28 * ageNorm);
      var seg = Math.max(1, Math.floor(cols / 56));
      for (x = 0; x < cols - 1; x += seg) {
        var xEnd = Math.min(cols - 1, x + seg);
        var mxDb = -135;
        for (var j = x; j <= xEnd; j++) { if (outMax[j] > mxDb) { mxDb = outMax[j]; } }
        var tWf = (mxDb - wf.min) / wfSpan;
        var tAd = (mxDb - lim.floor) / hSpan;
        var tCol = Math.max(0, Math.min(1, tWf * 0.45 + tAd * 0.72));
        var rgb = farbeBeiT(wf.colors, tCol);
        var rr = Math.min(255, Math.round(rgb[0] * (0.52 + 0.72 * fade)));
        var gg = Math.min(255, Math.round(rgb[1] * (0.52 + 0.72 * fade)));
        var bb = Math.min(255, Math.round(rgb[2] * (0.52 + 0.72 * fade)));
        ctx.strokeStyle = "rgba(" + rr + "," + gg + "," + bb + "," + (0.98 - 0.22 * d).toFixed(2) + ")";
        ctx.beginPath();
        for (var q = x; q <= xEnd; q++) {
          var nq = Math.max(0, Math.min(1, (outMax[q] - lim.floor) / hSpan));
          var qx = projX(q / (cols - 1), d);
          var qy = base - nq * liftScale;
          if (q === x) { ctx.moveTo(qx, qy); } else { ctx.lineTo(qx, qy); }
        }
        ctx.stroke();
      }
    }

    if (g.hz >= win.f0 && g.hz <= win.f1) {
      var uVfo = (g.hz - win.f0) / win.bw;
      var xF = projX(uVfo, 0), yF = projY(0);
      var xB = projX(uVfo, 1), yB = projY(1);
      ctx.strokeStyle = "rgba(239,68,68,0.9)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(xF, yF);
      ctx.lineTo(xB, yB);
      ctx.lineTo(xB, topY + 6);
      ctx.stroke();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(xB, topY + 8);
      ctx.lineTo(xB - 4, topY + 2);
      ctx.lineTo(xB + 4, topY + 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "start";
  }

  function scopeZeichnen(i, w, force) {
    if (!w) { return; }
    var cvSel = (i === 2) ? '[data-feld="w3scope"]' : ((i === 1) ? '[data-feld="w2scope"]' : '[data-feld="scopecanvas"]');
    var cv = w.querySelector(cvSel);
    if (!cv) { return; }
    var g = Z.geraete[i];
    if (!g || !g.offen) { return; }

    var now = Date.now();
    var p3 = window.Plugins && Plugins.dnx_3dtool;
    var curPos = (p3 && typeof p3._pos === "number") ? p3._pos : -1;
    var rect = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
    var cw = Math.max(200, cv.clientWidth || 340);
    var ch = Math.max(54, cv.clientHeight || 82);
    var rw = (rect && rect.width > 100) ? rect.width : cw;
    var rh = (rect && rect.height > 40) ? rect.height : ch;
    var curMode = (i === 2) ? (SCOPE.mode3 || "std") : ((i === 1) ? (SCOPE.mode2 || "std") : SCOPE.mode);
    var visKey = (g.hz || 0) + "|" + (window.center_freq || 0) + "|" + (window.bandwidth || 0) + "|" +
                 curMode + "|" + SCOPE.palette + "|" + SCOPE.peakHold + "|" + SCOPE.grid3d + "|" +
                 SCOPE.autoLevel + "|" + SCOPE.wfDown + "|" + SCOPE.centered + "|" + SCOPE.spanHz + "|" +
                 SCOPE.expand + "|" + SCOPE.speedIdx + "|" + Math.round(rw);
    var speed = SCOPE_SPEEDS[SCOPE.speedIdx] || SCOPE_SPEEDS[0];
    var lastD = (i === 2) ? SCOPE.lastDraw3 : ((i === 1) ? SCOPE.lastDraw2 : SCOPE.lastDraw);
    var lastVK = (i === 2) ? SCOPE.lastVisKey3 : ((i === 1) ? SCOPE.lastVisKey2 : SCOPE.lastVisKey);
    var lastP = (i === 2) ? SCOPE.lastPos3 : ((i === 1) ? SCOPE.lastPos2 : SCOPE.lastPos);
    var lastS = (i === 2) ? SCOPE.lastSeq3 : ((i === 1) ? SCOPE.lastSeq2 : SCOPE.lastSeq);
    var dataChanged = (curPos !== lastP) || (LIVE_FFT.seq !== lastS) || (visKey !== lastVK);
    if (!force && !dataChanged && (now - lastD) < 900) { return; }
    if (!force && (now - lastD) < speed.ms && visKey === lastVK) { return; }

    var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    var bw = Math.round(Math.max(cw, rw) * dpr), bh = Math.round(Math.max(ch, rh) * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    var ctx = cv.getContext("2d");
    if (!ctx) { return; }
    ctx.setTransform(bw / cw, 0, 0, bh / ch, 0, 0);

    var win = scopeFensterBerechnen(g);
    scopeSkalaAktualisieren(w, g, win, i);

    var src = scopeZeilenQuelle();
    if (!src || !(win.rfBw > 0)) {
      ctx.fillStyle = "#060e1f";
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 9.5px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.fillText("Warte auf Live-Wasserfall …", cw / 2, ch / 2 + 3);
      ctx.textAlign = "start";
      if (i === 2) { SCOPE.lastDraw3 = now; }
      else if (i === 1) { SCOPE.lastDraw2 = now; }
      else { SCOPE.lastDraw = now; }
      return;
    }

    var wf = wfFarbenUndPegel();
    var cols = Math.min(260, Math.max(130, Math.round(cw * 0.62)));

    if (curMode === "multi") {
      var leftW = Math.round(cw * 0.54);
      var rightW = cw - leftW - 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, leftW, ch); ctx.clip();
      scopeZeichne2D(ctx, leftW, ch, 0, src, win, wf, g, speed.step, Math.max(96, Math.round(cols * 0.6)));
      ctx.restore();
      ctx.fillStyle = "rgba(96,165,250,0.45)";
      ctx.fillRect(leftW, 0, 2, ch);
      ctx.save();
      ctx.translate(leftW + 2, 0);
      ctx.beginPath(); ctx.rect(0, 0, rightW, ch); ctx.clip();
      scopeZeichne3D(ctx, rightW, ch, 0, src, win, wf, g, speed.step, Math.max(88, Math.round(cols * 0.55)));
      ctx.restore();
    } else if (curMode === "3d") {
      scopeZeichne3D(ctx, cw, ch, 0, src, win, wf, g, speed.step, cols);
    } else {
      scopeZeichne2D(ctx, cw, ch, 0, src, win, wf, g, speed.step, cols);
    }

    if (i === 2) {
      SCOPE.lastPos3 = curPos;
      SCOPE.lastSeq3 = LIVE_FFT.seq;
      SCOPE.lastVisKey3 = visKey;
      SCOPE.lastDraw3 = now;
    } else if (i === 1) {
      SCOPE.lastPos2 = curPos;
      SCOPE.lastSeq2 = LIVE_FFT.seq;
      SCOPE.lastVisKey2 = visKey;
      SCOPE.lastDraw2 = now;
    } else {
      SCOPE.lastPos = curPos;
      SCOPE.lastSeq = LIVE_FFT.seq;
      SCOPE.lastVisKey = visKey;
      SCOPE.lastDraw = now;
    }
  }

  /* ================= Vorlage 1 (Funkgerät 1 — v8.10 Straight-On ohne Lautsprecher) == */
  var FT_IMG_URL = "static/plugins/receiver/funkgeraet1_ft710_v8_113.png?v=810";
  var FT_W0 = 617, FT_H0 = 242;

  function ftBox(x0, y0, x1, y1) {
    return "left:" + (x0 * 100 / FT_W0).toFixed(3) + "%;top:" + (y0 * 100 / FT_H0).toFixed(3) +
           "%;width:" + ((x1 - x0) * 100 / FT_W0).toFixed(3) + "%;height:" + ((y1 - y0) * 100 / FT_H0).toFixed(3) + "%;";
  }
  function ftKnobBox(cx, cy, r) {
    return ftBox(cx - r, cy - r, cx + r, cy + r);
  }

  /* Dynamische VFO-Leuchtsicheln + POWER-LED + Knob-Zeiger ueber dem Originalfoto */
  function ftKnobsRedraw(w, farbe) {
    if (!w) { return; }
    var f = farbe || lichtObj(lichtIdLesen(0));
    var hex = f.aus ? "#64748b" : f.hex;
    var rgb = f.aus ? "100,116,139" : f.rgb;

    /* VFO Side Glow Arcs (cx=473.5, cy=151.0, r=78.5 in 617x242) mit weichem Lichtverlauf */
    var gs = w.querySelectorAll("[data-vfo-stop]");
    Array.prototype.forEach.call(gs, function (st) {
      st.setAttribute("stop-color", f.aus ? "#94a3b8" : hex);
    });
    var glows = w.querySelectorAll("[data-vfo-glow]");
    Array.prototype.forEach.call(glows, function (a) {
      a.setAttribute("stroke", f.aus ? "rgba(148,163,184,0.14)" : hex);
      a.setAttribute("stroke-opacity", f.aus ? "0.14" : "0.42");
    });
    var arcs = w.querySelectorAll("[data-vfo-arc]");
    Array.prototype.forEach.call(arcs, function (a) {
      a.setAttribute("stroke-opacity", f.aus ? "0.22" : "0.95");
    });
    var pwrDot = w.querySelector("[data-pwr-led]");
    if (pwrDot) {
      var dim = !!w.querySelector(".ft-screen-slot.dim");
      pwrDot.setAttribute("fill", dim ? "#475569" : (f.aus ? "#22c55e" : hex));
      pwrDot.style.filter = dim ? "none" : ("drop-shadow(0 0 3.5px " + (f.aus ? "#22c55e" : hex) + ")");
    }

    /* 5 Drehknopfe: realistische gefraeste Markierung + dezentes LED-Leuchten */
    Array.prototype.forEach.call(w.querySelectorAll("canvas.ft-knob-cv"), function (cv) {
      var ang = parseFloat(cv.dataset.ang || "0") || 0;
      var istVfo = (cv.dataset.knob === "vfo");
      var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      var rect = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
      var cssW = Math.max(cv.clientWidth || (istVfo ? 104 : 28), (rect && rect.width > 12) ? rect.width : 0);
      var px = Math.max(20, Math.round(cssW * dpr));
      if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
      var ctx = cv.getContext("2d");
      if (!ctx) { return; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      var r = px / 2;
      var rad = (ang - 90) * Math.PI / 180;

      if (istVfo) {
        var vx0 = r + Math.cos(rad) * r * 0.78;
        var vy0 = r + Math.sin(rad) * r * 0.78;
        var vx1 = r + Math.cos(rad) * r * 0.92;
        var vy1 = r + Math.sin(rad) * r * 0.92;
        ctx.beginPath();
        ctx.moveTo(vx0, vy0);
        ctx.lineTo(vx1, vy1);
        ctx.strokeStyle = f.aus ? "rgba(255,255,255,0.30)" : ("rgba(" + rgb + ",0.55)");
        ctx.lineWidth = Math.max(1.4, 1.5 * dpr);
        ctx.lineCap = "round";
        ctx.stroke();
        return;
      }

      /* Dezente Skalen-Kerben um kleine Knoepfe */
      var x0 = r + Math.cos(rad) * r * 0.30;
      var y0 = r + Math.sin(rad) * r * 0.30;
      var x1 = r + Math.cos(rad) * r * 0.70;
      var y1 = r + Math.sin(rad) * r * 0.70;
      if (!f.aus) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = "rgba(" + rgb + ",0.55)";
        ctx.lineWidth = Math.max(2.6, 2.8 * dpr);
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = f.aus ? "rgba(226,232,240,0.9)" : "#f8fafc";
      ctx.lineWidth = Math.max(1.3, 1.35 * dpr);
      ctx.lineCap = "round";
      ctx.stroke();
    });
  }

  /* ================= DUAL WATCH (DW) & SCAN ENGINE (111-Paritaet) ======= */
  var DW_STATE = { aktiv: false, timer: null, holdUntil: 0, phaseB: false, boden: null };
  var SCAN_STATE = { aktiv: false, timer: null, holdUntil: 0, memIdx: 0, hamIdx: 0, dir: 1, boden: null, ticks: 0 };

  function scanTrefferPruefen(db, stObj) {
    if (db === null || !isFinite(db)) { return false; }
    if (typeof MENU_STAND.squelch === "number" && MENU_STAND.squelch > -149) {
      return db >= MENU_STAND.squelch;
    }
    if (stObj.boden === null || db < stObj.boden) { stObj.boden = db; }
    else { stObj.boden = Math.min(db, stObj.boden + 0.08); }
    var rand = (typeof MENU_STAND.scanSchwelle === "number") ? MENU_STAND.scanSchwelle : 10;
    return db > stObj.boden + rand;
  }

  function dwStoppen(i, meldung) {
    if (DW_STATE.timer) { clearInterval(DW_STATE.timer); DW_STATE.timer = null; }
    DW_STATE.aktiv = false;
    DW_STATE.phaseB = false;
    DW_STATE.boden = null;
    var g = Z.geraete[i];
    if (g) {
      g.dwAn = false;
      if (meldung !== undefined) { g.meldung = meldung; }
    }
    zeichnen();
  }

  function scanStoppen(i, meldung) {
    if (SCAN_STATE.timer) { clearInterval(SCAN_STATE.timer); SCAN_STATE.timer = null; }
    SCAN_STATE.aktiv = false;
    SCAN_STATE.boden = null;
    var g = Z.geraete[i];
    if (g) {
      g.scanAn = false;
      if (meldung !== undefined) { g.meldung = meldung; }
    }
    zeichnen();
  }

  function dwToggle(i) {
    var g = Z.geraete[i];
    if (!g) { return; }
    if (DW_STATE.aktiv) {
      dwStoppen(i, "DW AUS");
      setTimeout(function () { if (g.meldung === "DW AUS") { g.meldung = ""; zeichnen(); } }, 1600);
      return;
    }
    if (SCAN_STATE.aktiv) { scanStoppen(i); }
    var fz = fensterJetzt();
    if (!g.b || Math.abs(g.b - g.hz) < 500 || (fz && Math.abs(g.b - fz.mitte) > fz.halb)) {
      var cand = g.hz + 50000;
      if (fz && Math.abs(cand - fz.mitte) > fz.halb) { cand = g.hz - 50000; }
      if (fz && Math.abs(cand - fz.mitte) > fz.halb) { cand = fz.mitte; }
      g.b = Math.round(cand);
      sichern();
    }
    DW_STATE.aktiv = true;
    DW_STATE.phaseB = false;
    DW_STATE.holdUntil = 0;
    DW_STATE.boden = null;
    g.dwAn = true;
    g.meldung = "DW: VFO-A ↔ VFO-B (" + hzKurz(g.b) + " MHz)";
    zeichnen();
    DW_STATE.timer = setInterval(function () {
      var gg = Z.geraete[i];
      if (!DW_STATE.aktiv || !gg || !gg.offen) { dwStoppen(i); return; }
      var db = smeterDb();
      var now = Date.now();
      if (scanTrefferPruefen(db, DW_STATE)) {
        DW_STATE.holdUntil = now + 2200;
        gg.meldung = "DW HOLD (" + (DW_STATE.phaseB ? "VFO-B" : "VFO-A") + " " + db.toFixed(0) + " dB)";
        zeichnen();
        return;
      }
      if (now < DW_STATE.holdUntil) { return; }
      var alt = gg.hz;
      var neu = gg.b || gg.hz;
      gg.b = alt;
      DW_STATE.phaseB = !DW_STATE.phaseB;
      gg.vfoB = DW_STATE.phaseB;
      abstimmen(i, neu, null, "DW: " + (DW_STATE.phaseB ? "VFO-B" : "VFO-A") + " " + hzKurz(neu) + " MHz");
    }, 1150);
  }

  function scanToggle(i) {
    var g = Z.geraete[i];
    if (!g) { return; }
    if (SCAN_STATE.aktiv) {
      scanStoppen(i, "SCAN GESTOPPT");
      setTimeout(function () { if (g.meldung === "SCAN GESTOPPT") { g.meldung = ""; zeichnen(); } }, 1600);
      return;
    }
    if (DW_STATE.aktiv) { dwStoppen(i); }
    SCAN_STATE.aktiv = true;
    SCAN_STATE.holdUntil = 0;
    SCAN_STATE.boden = null;
    SCAN_STATE.ticks = 0;
    g.scanAn = true;
    var mod = MENU_STAND.scanModus || "band";
    g.meldung = (mod === "speicher") ? "SCAN: Speicher-Suchlauf…" :
                ((mod === "ham") ? "SCAN: HAM-Bänder…" : "SCAN: Band-Suchlauf…");
    zeichnen();
    var tempoMs = (MENU_STAND.scanTempo === "langsam") ? 480 : ((MENU_STAND.scanTempo === "schnell") ? 150 : 260);
    SCAN_STATE.timer = setInterval(function () {
      var gg = Z.geraete[i];
      if (!SCAN_STATE.aktiv || !gg || !gg.offen) { scanStoppen(i); return; }
      var now = Date.now();
      var db = smeterDb();
      SCAN_STATE.ticks++;
      if (SCAN_STATE.ticks >= 2 && scanTrefferPruefen(db, SCAN_STATE) && now > SCAN_STATE.holdUntil + 600) {
        SCAN_STATE.holdUntil = now + 2600;
        gg.meldung = "SCAN TREFFER " + hzKurz(gg.hz) + " MHz (" + db.toFixed(0) + " dB)";
        zeichnen();
        return;
      }
      if (now < SCAN_STATE.holdUntil) { return; }

      var fz = fensterJetzt();
      if (MENU_STAND.scanModus === "speicher" && SPEICHER.length) {
        for (var tr = 0; tr < SPEICHER.length; tr++) {
          SCAN_STATE.memIdx = (SCAN_STATE.memIdx + 1) % SPEICHER.length;
          var sp = SPEICHER[SCAN_STATE.memIdx];
          if (!fz || Math.abs(sp.hz - fz.mitte) <= fz.halb) {
            abstimmen(i, sp.hz, sp.m, "SCAN MEM: " + sp.n);
            return;
          }
        }
      }
      if (MENU_STAND.scanModus === "ham") {
        SCAN_STATE.hamIdx = (SCAN_STATE.hamIdx + 1) % BAENDER.length;
        var hb = BAENDER[SCAN_STATE.hamIdx];
        if (!fz || Math.abs(hb.hz - fz.mitte) <= fz.halb) {
          abstimmen(i, hb.hz, bandModus(hb.n), "SCAN HAM: " + hb.n);
          return;
        }
        if (profilFuerBand(hb.n)) {
          bandWaehlen(i, hb);
          return;
        }
      }
      var stepHz = Math.max(1000, gg.schritt || 5000);
      var nextHz = gg.hz + stepHz * SCAN_STATE.dir;
      if (fz) {
        if (nextHz > fz.bis - 2000) { nextHz = fz.von + 2000; }
        if (nextHz < fz.von + 2000) { nextHz = fz.bis - 2000; }
      }
      abstimmen(i, nextHz, null, "SCAN " + hzKurz(nextHz) + " MHz");
    }, tempoMs);
  }

  /* Hilfsfunktion: Prozentanzeige Lautstaerke (0..150% passend zu OpenWebRX+ & 111) */
  function volProzent() {
    var v = lautstaerkeJetzt();
    if (v === null || isNaN(v)) { return (typeof MENU_STAND.vol === "number") ? MENU_STAND.vol : 100; }
    return Math.max(0, Math.min(150, Math.round(v)));
  }
  function volSetzen(pct) {
    pct = Math.max(0, Math.min(150, Math.round(pct)));
    MENU_STAND.vol = pct;
    menuStandSichern();
    lautstaerkeSetzen(pct);
    return pct;
  }

  /* Telemetrie & Regler-Synchronisation direkt auf Geraet 1 */
  function ftTelemetrieSync(w) {
    if (!w) { return; }
    var v = volProzent();
    var sqV = (typeof MENU_STAND.squelch === "number") ? MENU_STAND.squelch : -150;
    var rfV = (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf;
    var sqTxt = (sqV <= -149) ? "AUS" : (sqV + "dB");
    var rfTxt = (_rfState.modus === "auto") ? "AGC" : (rfV + "dB");

    var bVol = w.querySelector('[data-feld="tvol"]');
    var bSq  = w.querySelector('[data-feld="tsq"]');
    var bRf  = w.querySelector('[data-feld="trf"]');
    if (bVol) { bVol.textContent = "VOL " + v + "%"; }
    if (bSq)  { bSq.textContent  = "SQ " + sqTxt; bSq.classList.toggle("an", sqV > -149); }
    if (bRf)  { bRf.textContent  = "RF " + rfTxt; bRf.classList.toggle("an", _rfState.modus !== "auto"); }

    var afCv = w.querySelector('canvas[data-knob="af"]');
    if (afCv) { afCv.dataset.ang = String(-135 + (v / 150) * 270); }
    var rfCv = w.querySelector('canvas[data-knob="rf"]');
    if (rfCv) {
      var rfModeSq = (rfCv.dataset.mode === "sq");
      var norm = rfModeSq ? ((sqV + 150) / 150) : ((rfV - RF_MIN) / Math.max(1, RF_MAX - RF_MIN));
      rfCv.dataset.ang = String(-135 + Math.max(0, Math.min(1, norm)) * 270);
    }
    var stCv = w.querySelector('canvas[data-knob="step"]');
    if (stCv) {
      var g0 = Z.geraete[0] || {};
      var sIdx = Math.max(0, SCHRITTE.indexOf(g0.schritt || 1000));
      stCv.dataset.ang = String(-115 + (sIdx / Math.max(1, SCHRITTE.length - 1)) * 230);
    }
    ftKnobsRedraw(w, lichtObj(lichtIdLesen(0)));

    var pop = w.querySelector('[data-pop="level"]');
    if (pop && pop.classList.contains("offen")) {
      var rVol = pop.querySelector('[data-lvl="vol"]'), lVol = pop.querySelector('[data-lvlval="vol"]');
      if (rVol) { rVol.value = String(v); } if (lVol) { lVol.textContent = v + " %"; }
      var rSq = pop.querySelector('[data-lvl="sq"]'), lSq = pop.querySelector('[data-lvlval="sq"]');
      if (rSq) { rSq.value = String(sqV); } if (lSq) { lSq.textContent = (sqV <= -149) ? "AUS" : (sqV + " dB"); }
      var rRf = pop.querySelector('[data-lvl="rf"]'), lRf = pop.querySelector('[data-lvlval="rf"]');
      if (rRf) { rRf.value = String(rfV); } if (lRf) { lRf.textContent = rfTxt; }
      var bTon = pop.querySelector('[data-ton="1"]');
      if (bTon) { bTon.classList.toggle("an", !!MENU_STAND.ton); }
    }
  }

  function bauenV1(i) {
    var g = Z.geraete[i];
    var w = document.createElement("div");
    w.className = "fgw fg-w1";
    w.id = "fg-geraet-" + i;

    scopeCfgLaden();
    if (!SCOPE.mode) { SCOPE.mode = "3d"; }
    fftHookInstallieren();

    var miniSvg =
      '<svg class="ft-pb-svg" viewBox="0 0 120 16" preserveAspectRatio="none">' +
        '<line x1="2" y1="14" x2="118" y2="14" stroke="#94a3b8" stroke-width="0.9"/>' +
        '<path data-pb="1" d="M 32 14 L 37 2 L 88 2 L 93 14" fill="rgba(147,197,253,.18)" stroke="#f1f5f9" stroke-width="1.1"/>' +
        '<rect data-pbbar="1" x="52" y="3" width="18" height="11" fill="rgba(226,232,240,.30)"/>' +
      '</svg>';

    /* Linker & rechter VFO-Leuchtbogen (cx=473.5, cy=151.0, r=78.5) mit weichem Verlauf + POWER-LED */
    var vfoArcSvg =
      '<svg class="ft-photo-svg" viewBox="0 0 617 242" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs>' +
          '<linearGradient id="ftVfoGrad" x1="0" y1="115" x2="0" y2="187" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0%" data-vfo-stop="1" stop-color="#4f94ff" stop-opacity="0"/>' +
            '<stop offset="22%" data-vfo-stop="1" stop-color="#4f94ff" stop-opacity="0.92"/>' +
            '<stop offset="50%" data-vfo-stop="1" stop-color="#4f94ff" stop-opacity="1"/>' +
            '<stop offset="78%" data-vfo-stop="1" stop-color="#4f94ff" stop-opacity="0.92"/>' +
            '<stop offset="100%" data-vfo-stop="1" stop-color="#4f94ff" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<filter id="ftVfoBlur" x="-30%" y="-30%" width="160%" height="160%">' +
            '<feGaussianBlur stdDeviation="2.4"/>' +
          '</filter>' +
        '</defs>' +
        '<path data-vfo-glow="1" d="M 402.9 116.6 A 78.5 78.5 0 0 0 402.9 185.4" fill="none" stroke="#4f94ff" stroke-width="6.0" stroke-linecap="round" filter="url(#ftVfoBlur)"/>' +
        '<path data-vfo-glow="1" d="M 544.1 116.6 A 78.5 78.5 0 0 1 544.1 185.4" fill="none" stroke="#4f94ff" stroke-width="6.0" stroke-linecap="round" filter="url(#ftVfoBlur)"/>' +
        '<path data-vfo-arc="L" d="M 402.9 116.6 A 78.5 78.5 0 0 0 402.9 185.4" fill="none" stroke="url(#ftVfoGrad)" stroke-width="2.3" stroke-linecap="round"/>' +
        '<path data-vfo-arc="R" d="M 544.1 116.6 A 78.5 78.5 0 0 1 544.1 185.4" fill="none" stroke="url(#ftVfoGrad)" stroke-width="2.3" stroke-linecap="round"/>' +
        '<rect data-pwr-led="1" x="24.5" y="63.6" width="12.5" height="2.4" rx="1.1" fill="#4f94ff"/>' +
      '</svg>';

    var padHtml = "";
    ["1","2","3","4","5","6","7","8","9",".","0","C"].forEach(function (k) {
      if (k === "C") {
        padHtml += '<button type="button" class="ft-pad-clr" data-tat="clr">CLR</button>';
      } else {
        padHtml += '<button type="button" data-ziffer="' + k + '">' + k + '</button>';
      }
    });

    var hamLidHtml = HAM_LEISTE_BAENDER.map(function (bn) {
      return '<button type="button" class="ft-hambtn" data-band="' + bn + '" title="HAM-Band ' + bn + '">' + bn.replace(/\s+/g, "") + '</button>';
    }).join("");

    w.innerHTML =
      '<div class="ft-shell">' +
        '<div class="ft-stage">' +
          '<div class="ft-chassis" data-griff title="Gerät verschieben">' +
            '<img class="ft-photo" src="' + FT_IMG_URL + '" alt="Funkgerät 1" draggable="false">' +
            vfoArcSvg +

            /* 1. Schlanke Oberkanten-Leiste auf dem Geraetedeckel: VOL · SQ · RF + direkte HAM-Baender */
            '<div class="ft-lid-bar" style="' + ftBox(54.0, 3.0, 554.0, 17.5) + '">' +
              '<div class="ft-lid-telem">' +
                '<button type="button" class="ft-tpill" data-tpill="vol" data-feld="tvol" title="Lautstärke 0–150% (Mausrad / Klick / Doppelklick=Stumm)">VOL 100%</button>' +
                '<button type="button" class="ft-tpill" data-tpill="sq" data-feld="tsq" title="Squelch (Mausrad / Klick=Reset)">SQ AUS</button>' +
                '<button type="button" class="ft-tpill" data-tpill="rf" data-feld="trf" title="RF-Gain (Mausrad / Klick)">RF 20dB</button>' +
              '</div>' +
              '<div class="ft-lid-ham" data-feld="lidham">' +
                hamLidHtml +
                '<button type="button" class="ft-hambtn ft-ham-more" data-popopen="band" title="Alle 17 HAM-Bänder + ULF + Server-Profile">HAM+</button>' +
              '</div>' +
            '</div>' +

            /* 2. Obere Display-Blende (markenfrei retuschierte Zeile): COLOR · DW · SCAN · WF-OPT · BAND · MENÜ */
            '<div class="ft-top-bar" style="' + ftBox(58.5, 27.5, 324.5, 43.5) + '">' +
              '<button type="button" class="ft-bar-btn" data-tat="color" title="Tasten- & VFO-Ring-Farbe wechseln (COLOR)">' +
                '<i data-feld="lichtpunkt"></i><span>COLOR</span><em data-feld="lichtname">BLAU</em>' +
              '</button>' +
              '<button type="button" class="ft-bar-btn" data-tat="dw" title="Dual Watch: VFO-A & VFO-B abwechselnd überwachen">DW</button>' +
              '<button type="button" class="ft-bar-btn" data-tat="scan" title="Suchlauf (Band, Speicher oder HAM-Bänder)">SCAN</button>' +
              '<button type="button" class="ft-bar-btn" data-popopen="wfopt" title="Wasserfall-Optionen (3D / 2D / Multi / Flussrichtung / Palette)">WF OPT</button>' +
              '<button type="button" class="ft-bar-btn" data-popopen="band" title="Alle HAM-Bänder &amp; Profile">BAND▾</button>' +
              '<button type="button" class="ft-bar-btn ft-bar-menu" data-tat="menu" title="Geräte-Menü öffnen">☰</button>' +
            '</div>' +

            /* 3. TFT-Echtglas (69..315 x 45..194) */
            '<div class="ft-screen-slot" style="' + ftBox(69, 45, 315, 194) + '">' +
              '<div class="ft-scr-top">' +
                '<div class="ft-sm-wrap">' +
                  '<div class="ft-sm-arc" data-feld="smeter"></div>' +
                  '<div class="ft-db-row">' +
                    '<span class="ft-db-txt" data-feld="db">—</span>' +
                    '<span class="ft-ind-tags"><i data-ind="dw" title="Dual Watch">DW</i><i data-ind="scn" title="Scan">SCN</i><i data-ind="lck" title="VFO Lock">LCK</i></span>' +
                  '</div>' +
                '</div>' +
                '<div class="ft-vfo-col">' +
                  '<div class="ft-vfoa-row">' +
                    '<div class="ft-vfo-badge"><span class="ft-vfo-tag" data-ind="vfoa">VFO-A</span><button type="button" class="ft-mode-btn" data-popopen="mode" data-feld="modusbox" title="Betriebsart wählen">USB</button></div>' +
                    '<button type="button" class="ft-freq" data-popopen="pad" data-feld="freq" title="Klicken für Ziffernblock (Frequenzeingabe)">0<small>Hz</small></button>' +
                  '</div>' +
                  '<div class="ft-vfob-row">' +
                    '<div class="ft-vfo-badge sub"><span class="ft-vfo-tag" data-ind="vfob">VFO-B</span><span class="ft-submode" data-feld="submode">USB</span></div>' +
                    '<button type="button" class="ft-subb" data-ab="1" data-feld="freqb2" title="VFO-A ↔ VFO-B tauschen">0<small>Hz</small></button>' +
                    '<button type="button" class="ft-level-btn" data-popopen="level" title="VOL · SQ · RF-Gain · Filter einstellen">LEVEL</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="ft-scr-info">' +
                '<button type="button" class="ft-icell" data-attbtn="1" title="Eingangsdämpfer (0 / 10 / 20 dB)"><b>ATT</b><span data-feld="attval">OFF</span></button>' +
                '<button type="button" class="ft-icell" data-ipobtn="1" title="Vorverstärker / IPO"><b>IPO</b><span data-feld="ipoval">AMP2</span></button>' +
                '<button type="button" class="ft-icell" data-nar="1" title="ZF-Filter schmal/breit"><b>R.FIL</b><span data-feld="rfilval">2.4k</span></button>' +
                '<button type="button" class="ft-icell" data-agcbtn="1" title="AGC-Regelung"><b>AGC</b><span data-feld="agcval">AUTO</span></button>' +
                '<div class="ft-pb-wrap">' +
                  miniSvg +
                  '<button type="button" class="ft-scope-info" data-popopen="wfopt" data-feld="scopeinfo" title="Wasserfall-Optionen öffnen"><b>3DSS</b> · FAST2 · FULL ▾</button>' +
                '</div>' +
              '</div>' +

              '<div class="ft-scr-scope' + (SCOPE.expand ? " expand" : "") + '">' +
                '<canvas class="ft-scope-cv" data-feld="scopecanvas" title="Klick im Spektrum stimmt sofort ab"></canvas>' +
                '<div class="ft-scope-axis">' +
                  '<span data-feld="sf0">-200k</span><span data-feld="sf1">-100k</span>' +
                  '<span class="mid" data-feld="scopefreq">30.500.000</span>' +
                  '<span data-feld="sf3">+100k</span><span data-feld="sf4">+200k</span>' +
                '</div>' +
              '</div>' +

              '<div class="ft-scr-meta">' +
                '<span data-feld="meta">USB · FIL 2,4 kHz</span>' +
                '<span class="ft-status-msg" data-feld="status">BEREIT</span>' +
              '</div>' +

              '<div class="ft-softkeys">' +
                '<button type="button" data-scope="center" title="Auf VFO-Frequenz zentrieren">CENTER</button>' +
                '<button type="button" data-scope="3dss" title="Zwischen 3D (3DSS) und normalem 2D-Wasserfall umschalten">3DSS</button>' +
                '<button type="button" data-scope="multi" title="Multi-Ansicht: 2D + 3D gleichzeitig">MULTI</button>' +
                '<button type="button" data-scope="expand" title="Wasserfall vergrößern">EXPAND</button>' +
                '<button type="button" data-scope="span" title="Frequenzspanne wechseln">SPAN</button>' +
                '<button type="button" data-scope="speed" title="Wasserfall-Tempo">SPEED</button>' +
              '</div>' +

              /* --- Inline-Overlays innerhalb des TFT-Glases --- */
              '<div class="ft-pop" data-pop="level">' +
                '<div class="ft-pop-hd"><span>AUDIO · SQ · RF-GAIN · DSP</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-lvl-grid">' +
                  '<label class="ft-lvl-row"><b>VOL</b><input type="range" data-lvl="vol" min="0" max="150" step="1"><em data-lvlval="vol">100 %</em></label>' +
                  '<label class="ft-lvl-row"><b>SQ</b><input type="range" data-lvl="sq" min="-150" max="0" step="1"><em data-lvlval="sq">AUS</em></label>' +
                  '<label class="ft-lvl-row"><b>RF</b><input type="range" data-lvl="rf" min="' + RF_MIN + '" max="' + RF_MAX + '" step="1"><em data-lvlval="rf">20 dB</em></label>' +
                  '<div class="ft-lvl-btns">' +
                    '<button type="button" data-asc="1" title="Auto-Squelch umschalten">ASC</button>' +
                    '<button type="button" data-nb="1" title="Noise Blanker">NB</button>' +
                    '<button type="button" data-dnr="1" title="Digital Noise Reduction">DNR</button>' +
                    '<button type="button" data-notch="1" title="Auto-Notch">NOTCH</button>' +
                    '<button type="button" data-cont="1" title="Contour / Audio-EQ">CONT</button>' +
                    '<button type="button" data-ton="1" title="Bedienton (Klick) ein/aus">TON</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="ft-pop" data-pop="wfopt">' +
                '<div class="ft-pop-hd"><span>WASSERFALL &amp; 3D-OPTIONEN</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-wf-opts">' +
                  '<div class="ft-wf-grp"><b>ANSICHT</b><div>' +
                    '<button type="button" data-wfmode="3d">3D (3DSS)</button>' +
                    '<button type="button" data-wfmode="std">2D NORMAL</button>' +
                    '<button type="button" data-wfmode="multi">MULTI</button>' +
                  '</div></div>' +
                  '<div class="ft-wf-grp"><b>FARBPALETTE</b><div>' +
                    '<button type="button" data-wfpal="ft710">BLAU-ROT</button>' +
                    '<button type="button" data-wfpal="owrx">OWRX</button>' +
                    '<button type="button" data-wfpal="feuer">FEUER</button>' +
                    '<button type="button" data-wfpal="eis">EIS</button>' +
                    '<button type="button" data-wfpal="gruen">GRÜN</button>' +
                  '</div></div>' +
                  '<div class="ft-wf-grp"><b>EXTRAS &amp; FLUSS</b><div>' +
                    '<button type="button" data-wftog="wfdir" data-feld="wfdirbtn">FLUSS: ABWÄRTS</button>' +
                    '<button type="button" data-wftog="peak">PEAK-HOLD</button>' +
                    '<button type="button" data-wftog="auto">AUTO-PEGEL</button>' +
                    '<button type="button" data-wftog="grid">3D-GITTER</button>' +
                    '<button type="button" data-scope="center">CENTER</button>' +
                    '<button type="button" data-scope="expand">EXPAND</button>' +
                  '</div></div>' +
                  '<div class="ft-wf-grp"><b>SPAN / TEMPO</b><div>' +
                    '<button type="button" data-scope="span" data-feld="wfspanbtn">SPAN: FULL</button>' +
                    '<button type="button" data-scope="speed" data-feld="wfspdbtn">TEMPO: FAST2</button>' +
                  '</div></div>' +
                '</div>' +
              '</div>' +

              '<div class="ft-pop" data-pop="band">' +
                '<div class="ft-pop-hd"><span>HAM-BÄNDER &amp; PROFILE</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-pop-grid g5">' +
                  BAENDER.map(function (b) {
                    return '<button type="button" data-band="' + b.n + '">' + b.n + '</button>';
                  }).join("") +
                '</div>' +
                '<button type="button" class="ft-pop-allprof" data-openprof="1">Alle Empfangsprofile im Menü öffnen ▸</button>' +
              '</div>' +

              '<div class="ft-pop" data-pop="mode">' +
                '<div class="ft-pop-hd"><span>MODUS WÄHLEN</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-pop-grid g3">' +
                  MODI.map(function (m) {
                    return '<button type="button" data-modus="' + m + '">' + m + '</button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ft-pop" data-pop="mem">' +
                '<div class="ft-pop-hd"><span>SPEICHERKANÄLE</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-pop-list">' +
                  SPEICHER.map(function (sp, idx) {
                    return '<button type="button" data-mem="' + idx + '"><b>' + sp.n + '</b><span>' + hzKurz(sp.hz) + ' MHz · ' + sp.m + '</span></button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ft-pop" data-pop="step">' +
                '<div class="ft-pop-hd"><span>ABSTIMMSCHRITT</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-pop-grid g3">' +
                  SCHRITTE.map(function (st) {
                    return '<button type="button" data-step="' + st + '">' + schrittText(st) + '</button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ft-pop" data-pop="pad">' +
                '<div class="ft-pop-hd"><span>FREQUENZ EINGEBEN</span><button type="button" data-popx>×</button></div>' +
                '<div class="ft-pad-disp"><span data-feld="eingabe">—</span><small>MHz (.) / kHz</small></div>' +
                '<div class="ft-pad-grid">' +
                  padHtml +
                  '<button type="button" class="ft-pad-ent" data-tat="enter">ENT (ÜBERNEHMEN)</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            /* 4. Linke Funktions-Spalte exakt auf den realen Tasten/Buchsen (617x242) */
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(12.0, 44.5, 49.5, 61.5) + '" data-tat="pwr" title="VFO-Sperre (LOCK) / Shift+Klick = Display dimmen"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(12.0, 72.5, 49.5, 87.5) + '" data-ftrx="TUNE" title="Antennen-Tuner (WebSDR: reiner Empfänger)"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(12.0, 97.0, 49.5, 112.5) + '" data-ftrx="VOX/MOX" title="VOX/MOX (WebSDR: reiner Empfänger)"></button>' +
            '<button type="button" class="ft-spot ft-spot-jack" style="' + ftBox(11.5, 119.5, 49.5, 162.0) + '" data-popopen="level" title="Kopfhörer / Lautstärke · SQ · RF-Gain"></button>' +
            '<button type="button" class="ft-spot ft-spot-jack" style="' + ftBox(11.5, 168.0, 50.5, 214.0) + '" data-tat="menu" title="Geräte-Menü öffnen"></button>' +

            /* 5. Obere Tastenreihe rechts (MODE, ZIN/SPOT, SPLIT, CLAR, NB) */
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(356.5, 18.0, 399.5, 30.0) + '" data-popopen="mode" title="Betriebsart (MODE)"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(402.5, 18.0, 445.5, 30.0) + '" data-zin="1" title="ZIN / Auf kHz-Raster einrasten"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(449.0, 18.0, 492.0, 30.0) + '" data-split="1" title="SPLIT ein/aus"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(495.5, 18.0, 538.5, 30.0) + '" data-rit="1" title="CLAR / RIT Feinabstimmung"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(542.5, 18.0, 586.5, 30.0) + '" data-nb="1" title="Noise Blanker (NB) ein/aus"></button>' +

            /* 6. Zweite Reihe rechts (M▶V, V/M, A/B, BAND, QMB) */
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(338.0, 43.0, 383.5, 57.5) + '" data-cs="1" title="M▶V: Nächster Speicherkanal"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(388.0, 43.0, 434.5, 57.5) + '" data-popopen="mem" title="V/M: Speicherkanäle"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(439.5, 43.0, 487.5, 57.5) + '" data-ab="1" title="VFO-A ↔ VFO-B tauschen"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(492.0, 43.0, 539.5, 57.5) + '" data-popopen="band" title="HAM-BAND auswählen"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(544.5, 43.0, 593.5, 57.5) + '" data-qmb="1" title="QMB Schnell-Speicher (1. Klick merken, 2. Klick abrufen)"></button>' +

            /* 7. Mittlere Flanken (DNR, NAR) & untere Tasten (DSP RESET, FINE/FAST) */
            '<button type="button" class="ft-spot ft-spot-key ft-spot-dnr" style="' + ftBox(382.0, 65.0, 429.5, 83.5) + '" data-dnr="1" title="DNR Rauschunterdrückung (0–3)"></button>' +
            '<button type="button" class="ft-spot ft-spot-key ft-spot-nar" style="' + ftBox(511.0, 65.0, 559.0, 83.5) + '" data-nar="1" title="NAR Schmalband-Filter"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(381.5, 198.0, 419.5, 217.5) + '" data-tat="dspreset" title="DSP / RIT / Filter zurücksetzen"></button>' +
            '<button type="button" class="ft-spot ft-spot-key" style="' + ftBox(525.5, 198.0, 563.5, 217.5) + '" data-fine="1" title="FINE (10 Hz) / FAST (5 kHz) umschalten"></button>' +

            /* 8. 5 echte interaktive Drehregler exakt auf den Knoepfen des lautsprecherlosen Fotos */
            '<div class="ft-knob" style="' + ftKnobBox(360.5, 110.0, 14.0) + '" data-kwrap="func" title="FUNC: Klicken für Menü · Mausrad für NR-Stufe">' +
              '<canvas class="ft-knob-cv" data-knob="func" data-ang="-40"></canvas>' +
            '</div>' +
            '<div class="ft-knob" style="' + ftKnobBox(360.0, 193.5, 14.0) + '" data-kwrap="step" title="STEP/MCH: Mausrad dreht Abstimmschritt · Klick öffnet Auswahl">' +
              '<canvas class="ft-knob-cv" data-knob="step" data-ang="0"></canvas>' +
            '</div>' +
            '<div class="ft-knob" style="' + ftKnobBox(587.5, 109.5, 14.0) + '" data-kwrap="rf" title="RF GAIN / SQL: Ziehen oder Mausrad · Klick schaltet RF ⇄ SQ um">' +
              '<canvas class="ft-knob-cv" data-knob="rf" data-mode="rf" data-ang="45"></canvas>' +
              '<span class="ft-knob-tag" data-feld="rfkmode">RF</span>' +
            '</div>' +
            '<div class="ft-knob" style="' + ftKnobBox(587.0, 192.5, 14.0) + '" data-kwrap="af" title="AF GAIN (VOL): Ziehen oder Mausrad für Lautstärke · Doppelklick=Stumm">' +
              '<canvas class="ft-knob-cv" data-knob="af" data-ang="60"></canvas>' +
            '</div>' +
            '<div class="ft-knob ft-vfo-knob" style="' + ftKnobBox(474.5, 151.5, 52.0) + '" data-feld="dial" title="VFO Abstimmrad: Ziehen, Mausrad oder Pfeiltasten">' +
              '<canvas class="ft-knob-cv" data-knob="vfo" data-ang="0"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        /* 9. Fenster-Griffe wie auf 111: 4 Ecken Resize, Geraetewechsel & klares Schliessen × */
        '<div class="fg-eck tl" data-eck="tl" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<div class="fg-eck tr" data-eck="tr" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<div class="fg-eck bl" data-eck="bl" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<div class="fg-eck br" data-eck="br" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<button type="button" class="fg-wechsel" data-wechsel="2" title="Zu Funkgerät 2 wechseln">⇄ 2</button>' +
        '<button type="button" class="fg-zu" data-zu title="Funkgerät 1 schließen">×</button>' +
      '</div>';

    /* --- Popover-Steuerung im Display --- */
    function popSchliessen() {
      Array.prototype.forEach.call(w.querySelectorAll(".ft-pop.offen"), function (p) { p.classList.remove("offen"); });
    }
    function popOeffnen(name) {
      var p = w.querySelector('[data-pop="' + name + '"]');
      if (!p) { return; }
      var warOffen = p.classList.contains("offen");
      popSchliessen();
      if (!warOffen) {
        p.classList.add("offen");
        if (name === "level") { ftTelemetrieSync(w); }
        if (name === "wfopt") { wfOptSync(); }
      }
    }
    function wfOptSync() {
      Array.prototype.forEach.call(w.querySelectorAll("[data-wfmode]"), function (b) {
        b.classList.toggle("an", b.getAttribute("data-wfmode") === SCOPE.mode);
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-wfpal]"), function (b) {
        b.classList.toggle("an", b.getAttribute("data-wfpal") === SCOPE.palette);
      });
      var bPk = w.querySelector('[data-wftog="peak"]'); if (bPk) { bPk.classList.toggle("an", !!SCOPE.peakHold); }
      var bAu = w.querySelector('[data-wftog="auto"]'); if (bAu) { bAu.classList.toggle("an", !!SCOPE.autoLevel); }
      var bGr = w.querySelector('[data-wftog="grid"]'); if (bGr) { bGr.classList.toggle("an", !!SCOPE.grid3d); }
      var bDir = w.querySelector('[data-feld="wfdirbtn"]');
      if (bDir) {
        bDir.textContent = SCOPE.wfDown ? "FLUSS: ABWÄRTS" : "FLUSS: AUFWÄRTS";
        bDir.classList.toggle("an", !SCOPE.wfDown);
      }
      var bC = w.querySelector('.ft-wf-opts [data-scope="center"]'); if (bC) { bC.classList.toggle("an", !!SCOPE.centered); }
      var bE = w.querySelector('.ft-wf-opts [data-scope="expand"]'); if (bE) { bE.classList.toggle("an", !!SCOPE.expand); }
      var bSp = w.querySelector('[data-feld="wfspanbtn"]');
      if (bSp) { bSp.textContent = "SPAN: " + (SCOPE.spanHz ? scopeSpanText(SCOPE.spanHz) : "FULL"); }
      var bSd = w.querySelector('[data-feld="wfspdbtn"]');
      if (bSd) { bSd.textContent = "TEMPO: " + (SCOPE_SPEEDS[SCOPE.speedIdx] ? SCOPE_SPEEDS[SCOPE.speedIdx].name : "FAST2"); }
    }

    Array.prototype.forEach.call(w.querySelectorAll("[data-popopen]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); popOeffnen(b.getAttribute("data-popopen")); };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-popx]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); popSchliessen(); };
    });
    var bOpenProf = w.querySelector('[data-openprof="1"]');
    if (bOpenProf) {
      bOpenProf.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        popSchliessen();
        menuZeigen(true, 4); /* Reiter PROFILE */
      };
    }

    /* --- Numpad & Tastatur im TFT --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-ziffer]"), function (t) {
      t.onclick = function () { fgKlick("taste"); tasteV1(i, t.dataset.ziffer); };
    });
    var clrB = w.querySelector('[data-tat="clr"]');
    if (clrB) { clrB.onclick = function () { fgKlick("taste"); EINGABE[i] = ""; zeichnen(); }; }
    var entB = w.querySelector('[data-tat="enter"]');
    if (entB) {
      entB.onclick = function () {
        if (Z.geraete[i].lockAn) { scopeToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast"); enterV1(i); popSchliessen();
      };
    }
    w.addEventListener("keydown", function (ev) {
      var pad = w.querySelector('[data-pop="pad"]');
      if (!pad || !pad.classList.contains("offen")) { return; }
      if (/^[0-9.]$/.test(ev.key)) { ev.preventDefault(); tasteV1(i, ev.key); }
      else if (ev.key === "Backspace") { ev.preventDefault(); EINGABE[i] = EINGABE[i].slice(0, -1); zeichnen(); }
      else if (ev.key === "Enter") {
        ev.preventDefault();
        if (Z.geraete[i].lockAn) { scopeToast("VFO GESPERRT (LOCK)"); return; }
        enterV1(i); popSchliessen();
      }
      else if (ev.key === "Escape") { ev.preventDefault(); popSchliessen(); }
    });

    /* --- Band / Modus / Speicher / Schritt --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-band]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        if (Z.geraete[i].lockAn) { scopeToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var bd = BAENDER.filter(function (x) { return x.n === b.dataset.band; })[0];
        if (bd) { bandWaehlen(i, bd); }
        popSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-modus]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        Z.aktiv = i;
        Z.geraete.forEach(function (gg) { gg.modus = b.dataset.modus; });
        empfangenModus(b.dataset.modus);
        sichern(); zeichnen(); popSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-mem]"), function (b) {
      b.onclick = function () {
        if (Z.geraete[i].lockAn) { scopeToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var sp = SPEICHER[parseInt(b.dataset.mem, 10)];
        if (sp) { Z.geraete[i].sp = parseInt(b.dataset.mem, 10); abstimmen(i, sp.hz, sp.m, sp.n); }
        popSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-step]"), function (b) {
      b.onclick = function () {
        fgKlick("rast");
        Z.geraete[i].schritt = parseInt(b.dataset.step, 10);
        sichern(); zeichnen(); ftTelemetrieSync(w); popSchliessen();
      };
    });

    /* --- Display-Softkeys + Inline Wasserfall-Optionen --- */
    function scopeToast(msg) {
      var gg = Z.geraete[i];
      if (!gg) { return; }
      gg.meldung = msg;
      zeichnen();
      setTimeout(function () { if (gg.meldung === msg) { gg.meldung = ""; zeichnen(); } }, 2000);
    }

    Array.prototype.forEach.call(w.querySelectorAll("[data-scope]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var act = b.getAttribute("data-scope");
        if (act === "center") {
          SCOPE.centered = !SCOPE.centered;
          scopeCfgSichern();
          scopeToast(SCOPE.centered ? "Scope: zentriert" : "Scope: Server-Ansicht");
        } else if (act === "3dss") {
          var neu = (SCOPE.mode === "3d") ? "std" : "3d";
          dnx3dModusSetzen(neu);
          scopeToast(neu === "3d" ? "3DSS-Wasserfall EIN" : "2D-Wasserfall EIN");
        } else if (act === "multi") {
          SCOPE.mode = (SCOPE.mode === "multi") ? "3d" : "multi";
          scopeCfgSichern();
          scopeToast(SCOPE.mode === "multi" ? "MULTI-Ansicht (2D + 3D)" : "3DSS-Ansicht");
        } else if (act === "expand") {
          SCOPE.expand = !SCOPE.expand;
          var sb = w.querySelector(".ft-scr-scope");
          if (sb) { sb.classList.toggle("expand", SCOPE.expand); }
          scopeCfgSichern();
          scopeToast(SCOPE.expand ? "Scope: groß" : "Scope: normal");
        } else if (act === "span") {
          var idx = SCOPE_SPANS.indexOf(SCOPE.spanHz);
          SCOPE.spanHz = SCOPE_SPANS[(idx + 1) % SCOPE_SPANS.length];
          if (SCOPE.spanHz > 0) { SCOPE.centered = true; }
          scopeCfgSichern();
          scopeToast("Spanne: " + (SCOPE.spanHz ? scopeSpanText(SCOPE.spanHz) : "FULL"));
        } else if (act === "speed") {
          SCOPE.speedIdx = (SCOPE.speedIdx + 1) % SCOPE_SPEEDS.length;
          scopeCfgSichern();
          scopeToast("Tempo: " + SCOPE_SPEEDS[SCOPE.speedIdx].name);
        }
        wfOptSync();
        scopeZeichnen(i, w, true);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-wfmode]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        var md = b.getAttribute("data-wfmode");
        if (md === "multi") { SCOPE.mode = "multi"; scopeCfgSichern(); }
        else { dnx3dModusSetzen(md); }
        wfOptSync();
        scopeZeichnen(i, w, true);
        scopeToast("Wasserfall: " + (md === "3d" ? "3DSS" : (md === "multi" ? "MULTI" : "2D NORMAL")));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-wfpal]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        SCOPE.palette = b.getAttribute("data-wfpal");
        scopeCfgSichern();
        wfOptSync();
        scopeZeichnen(i, w, true);
        scopeToast("Palette: " + b.textContent);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-wftog]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        var k = b.getAttribute("data-wftog");
        if (k === "peak") { SCOPE.peakHold = !SCOPE.peakHold; scopeToast("Peak-Hold " + (SCOPE.peakHold ? "EIN" : "AUS")); }
        if (k === "auto") { SCOPE.autoLevel = !SCOPE.autoLevel; scopeToast("Auto-Pegel " + (SCOPE.autoLevel ? "EIN" : "AUS")); }
        if (k === "grid") { SCOPE.grid3d = !SCOPE.grid3d; scopeToast("3D-Gitter " + (SCOPE.grid3d ? "EIN" : "AUS")); }
        if (k === "wfdir") {
          SCOPE.wfDown = !SCOPE.wfDown;
          scopeToast(SCOPE.wfDown ? "Wasserfall: ABWÄRTS (0s oben)" : "Wasserfall: AUFWÄRTS (0s unten)");
        }
        scopeCfgSichern();
        wfOptSync();
        scopeZeichnen(i, w, true);
      };
    });

    document.addEventListener("click", function (ev) {
      if (ev && ev.isTrusted === false) { return; }
      if (!w.querySelector(".ft-pop.offen")) { return; }
      if (ev.target && ev.target.closest && ev.target.closest(".ft-pop, [data-popopen], [data-tpill], [data-kwrap]")) { return; }
      popSchliessen();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && w.querySelector(".ft-pop.offen")) { popSchliessen(); }
    });

    var scCv = w.querySelector('[data-feld="scopecanvas"]');
    if (scCv) {
      scCv.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      scCv.addEventListener("click", function (ev) {
        if (Z.geraete[i].lockAn) { scopeToast("VFO GESPERRT (LOCK)"); return; }
        var r = scCv.getBoundingClientRect();
        if (!r || !(r.width > 10)) { return; }
        var relX = ev.clientX - r.left;
        var spanW = (SCOPE.mode === "multi") ? Math.max(10, r.width * 0.54) : Math.max(10, r.width - 6);
        var u = Math.max(0, Math.min(1, (SCOPE.mode === "multi" && relX > spanW) ? ((relX - spanW) / Math.max(10, r.width - spanW)) : (relX / spanW)));
        var win = scopeFensterBerechnen(Z.geraete[i]);
        abstimmen(i, Math.round(win.f0 + u * win.bw), null, "Scope: " + hzKurz(win.f0 + u * win.bw) + " MHz");
      });
    }

    var bCol = w.querySelector('[data-tat="color"]');
    if (bCol) {
      bCol.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var cur = lichtIdLesen(0), idx = 0;
        for (var k = 0; k < LICHT_FARBEN.length; k++) { if (LICHT_FARBEN[k].id === cur) { idx = k; break; } }
        var next = LICHT_FARBEN[(idx + 1) % LICHT_FARBEN.length];
        lichtAnwenden(next.id, 0);
        scopeToast("COLOR: " + next.name);
      };
    }
    var bDw = w.querySelector('[data-tat="dw"]');
    if (bDw) { bDw.onclick = function (ev) { ev.stopPropagation(); fgKlick("rast"); dwToggle(i); }; }
    var bScan = w.querySelector('[data-tat="scan"]');
    if (bScan) { bScan.onclick = function (ev) { ev.stopPropagation(); fgKlick("rast"); scanToggle(i); }; }
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="menu"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); menuZeigen(true); };
    });

    var bPwr = w.querySelector('[data-tat="pwr"]');
    if (bPwr) {
      bPwr.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("rast");
        if (ev.shiftKey) {
          var scr = w.querySelector(".ft-screen-slot");
          if (scr) { scr.classList.toggle("dim"); }
          ftKnobsRedraw(w, lichtObj(lichtIdLesen(0)));
          scopeToast((scr && scr.classList.contains("dim")) ? "DISPLAY GEDIMMT" : "DISPLAY HELL");
          return;
        }
        Z.geraete[i].lockAn = !Z.geraete[i].lockAn;
        zeichnen();
        scopeToast(Z.geraete[i].lockAn ? "VFO GESPERRT (LOCK)" : "VFO FREI");
      };
    }

    Array.prototype.forEach.call(w.querySelectorAll("[data-ftrx]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        scopeToast(b.getAttribute("data-ftrx") + ": WebSDR ist reiner Empfänger");
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-nb]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        MENU_STAND.nb = !MENU_STAND.nb; menuStandSichern();
        afSet("NB", MENU_STAND.nb);
        zeichnen();
        scopeToast("NB " + (MENU_STAND.nb ? "EIN" : "AUS"));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-dnr]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        MENU_STAND.nr = (MENU_STAND.nr + 1) % 4; menuStandSichern();
        nrSetzen(MENU_STAND.nr);
        afSet("NR", MENU_STAND.nr > 0);
        zeichnen();
        scopeToast(MENU_STAND.nr ? ("DNR STUFE " + MENU_STAND.nr) : "DNR AUS");
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-nar]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var bwList = [2400, 1800, 500, 3000];
        var idx = bwList.indexOf(MENU_STAND.filt || 2400);
        MENU_STAND.filt = bwList[(idx + 1) % bwList.length];
        menuStandSichern();
        zeichnen();
        scopeToast("FILTER: " + (MENU_STAND.filt >= 1000 ? (MENU_STAND.filt / 1000).toFixed(1) + " kHz" : (MENU_STAND.filt + " Hz")));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-fine]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var gg = Z.geraete[i];
        gg.schritt = (gg.schritt === 10) ? 1000 : ((gg.schritt === 1000) ? 5000 : 10);
        sichern(); zeichnen(); ftTelemetrieSync(w);
        scopeToast("SCHRITT: " + schrittText(gg.schritt));
      };
    });

    var bTon = w.querySelector('[data-ton="1"]');
    if (bTon) {
      bTon.onclick = function () {
        MENU_STAND.ton = !MENU_STAND.ton;
        menuStandSichern();
        if (MENU_STAND.ton) { fgKlick("rast"); }
        ftTelemetrieSync(w);
        scopeToast(MENU_STAND.ton ? "TASTENTON EIN" : "TASTENTON AUS");
      };
    }

    var bReset = w.querySelector('[data-tat="dspreset"]');
    if (bReset) {
      bReset.onclick = function () {
        fgKlick("rast");
        MENU_STAND.nb = false; MENU_STAND.nr = 0; MENU_STAND.notch = false; MENU_STAND.eq = false;
        afSet("NB", false); afSet("NR", false); afSet("Notch", false); afSet("EQ", false);
        Z.geraete.forEach(function (o) { o.ritAn = false; o.ritOff = 0; });
        var scr = w.querySelector(".ft-screen-slot");
        if (scr) { scr.classList.remove("dim"); }
        menuStandSichern();
        zeichnen();
        scopeToast("DSP & RIT zurückgesetzt");
      };
    }

    var pVol = w.querySelector('[data-tpill="vol"]');
    if (pVol) {
      pVol.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var nv = volSetzen(volProzent() + (ev.deltaY < 0 ? 5 : -5));
        ftTelemetrieSync(w);
        scopeToast("VOL: " + nv + "%");
      }, { passive: false });
      pVol.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); popOeffnen("level"); };
      pVol.ondblclick = function (ev) {
        ev.stopPropagation();
        var cur = volProzent();
        var nv = (cur > 0) ? (pVol.dataset.prevVol = String(cur), 0) : (parseInt(pVol.dataset.prevVol || "100", 10) || 100);
        volSetzen(nv);
        ftTelemetrieSync(w);
        scopeToast(nv === 0 ? "AUDIO STUMM" : ("VOL: " + nv + "%"));
      };
    }
    var pSq = w.querySelector('[data-tpill="sq"]');
    if (pSq) {
      pSq.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var sq = (typeof MENU_STAND.squelch === "number" ? MENU_STAND.squelch : -150) + (ev.deltaY < 0 ? 5 : -5);
        sq = Math.max(-150, Math.min(0, Math.round(sq)));
        MENU_STAND.squelch = sq; menuStandSichern(); squelchSetzen(sq); reglerSyncAlle();
        scopeToast("SQ: " + (sq <= -149 ? "AUS" : (sq + " dB")));
      }, { passive: false });
      pSq.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var nv = (MENU_STAND.squelch <= -149) ? -75 : -150;
        MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
        scopeToast(nv <= -149 ? "SQ: AUS" : ("SQ: " + nv + " dB"));
      };
    }
    var pRf = w.querySelector('[data-tpill="rf"]');
    if (pRf) {
      pRf.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var cur = (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf;
        var nv = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(cur + (ev.deltaY < 0 ? 2 : -2))));
        rfAnwenden(nv);
        scopeToast("RF-GAIN: " + nv + " dB");
      }, { passive: false });
      pRf.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); popOeffnen("level"); };
    }

    var lvVol = w.querySelector('[data-lvl="vol"]');
    if (lvVol) {
      lvVol.oninput = function () {
        var nv = volSetzen(parseInt(lvVol.value, 10));
        ftTelemetrieSync(w);
        scopeToast("VOL: " + nv + "%");
      };
    }
    var lvSq = w.querySelector('[data-lvl="sq"]');
    if (lvSq) {
      lvSq.oninput = function () {
        var nv = parseInt(lvSq.value, 10);
        MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
      };
    }
    var lvRf = w.querySelector('[data-lvl="rf"]');
    if (lvRf) {
      lvRf.oninput = function () {
        var nv = parseInt(lvRf.value, 10);
        rfAnwenden(nv);
        ftTelemetrieSync(w);
      };
    }
    var bAsc = w.querySelector('[data-asc="1"]');
    if (bAsc) {
      bAsc.onclick = function () {
        fgKlick("rast");
        var db = smeterDb();
        var autoSq = (MENU_STAND.squelch > -149) ? -150 : Math.max(-120, Math.min(-25, Math.round((db !== null ? db : -72) + 8)));
        MENU_STAND.squelch = autoSq; menuStandSichern(); squelchSetzen(autoSq); reglerSyncAlle();
        scopeToast(autoSq <= -149 ? "ASC AUS" : ("ASC: " + autoSq + " dB"));
      };
    }

    function bindSmallEncoder(knobName, onStep, onClick) {
      var wrap = w.querySelector('[data-kwrap="' + knobName + '"]');
      var cv = w.querySelector('canvas[data-knob="' + knobName + '"]');
      if (!wrap || !cv) { return; }
      var st = { down: false, y: 0, moved: 0, rest: 0 };
      function onMove(ev) {
        if (!st.down) { return; }
        ev.stopPropagation();
        if (ev.cancelable && ev.preventDefault) { ev.preventDefault(); }
        var dy = st.y - ev.clientY;
        st.y = ev.clientY;
        st.moved += Math.abs(dy);
        st.rest += dy;
        while (Math.abs(st.rest) >= 4) {
          var dir = st.rest > 0 ? 1 : -1;
          st.rest -= dir * 4;
          fgKlick("dial");
          onStep(dir);
        }
      }
      function onDone(ev, allowClick) {
        if (!st.down) { return; }
        st.down = false;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("blur", onCancel, true);
        if (allowClick && st.moved < 4 && onClick) { onClick(ev); }
      }
      function onUp(ev) { onDone(ev, true); }
      function onCancel(ev) { onDone(ev, false); }
      wrap.addEventListener("pointerdown", function (ev) {
        if (ev && ev.button && ev.button !== 0) { return; }
        st.down = true; st.y = ev.clientY; st.moved = 0; st.rest = 0;
        window.addEventListener("pointermove", onMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onCancel, true);
        window.addEventListener("blur", onCancel, true);
        ev.preventDefault(); ev.stopPropagation();
      });
      wrap.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        fgKlick("dial");
        onStep(ev.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }

    bindSmallEncoder("af", function (dir) {
      var nv = volSetzen(volProzent() + dir * 4);
      ftTelemetrieSync(w);
      scopeToast("AF GAIN (VOL): " + nv + "%");
    }, function () {
      popOeffnen("level");
    });

    bindSmallEncoder("rf", function (dir) {
      var rfCv = w.querySelector('canvas[data-knob="rf"]');
      if (rfCv && rfCv.dataset.mode === "sq") {
        var sq = Math.max(-150, Math.min(0, (MENU_STAND.squelch || -150) + dir * 4));
        MENU_STAND.squelch = sq; menuStandSichern(); squelchSetzen(sq); reglerSyncAlle();
        scopeToast("SQUELCH: " + (sq <= -149 ? "AUS" : (sq + " dB")));
      } else {
        var cur = (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf;
        var nv = Math.max(RF_MIN, Math.min(RF_MAX, cur + dir * 2));
        rfAnwenden(nv);
        ftTelemetrieSync(w);
        scopeToast("RF-GAIN: " + nv + " dB");
      }
    }, function () {
      var rfCv = w.querySelector('canvas[data-knob="rf"]');
      var tag = w.querySelector('[data-feld="rfkmode"]');
      if (rfCv) {
        var nextSq = (rfCv.dataset.mode !== "sq");
        rfCv.dataset.mode = nextSq ? "sq" : "rf";
        if (tag) { tag.textContent = nextSq ? "SQ" : "RF"; }
        ftTelemetrieSync(w);
        scopeToast(nextSq ? "Regler auf SQUELCH (SQ)" : "Regler auf RF-GAIN");
      }
    });

    bindSmallEncoder("step", function (dir) {
      var gg = Z.geraete[i];
      var idx = SCHRITTE.indexOf(gg.schritt);
      if (idx < 0) { idx = 2; }
      var nIdx = Math.max(0, Math.min(SCHRITTE.length - 1, idx + dir));
      gg.schritt = SCHRITTE[nIdx];
      sichern(); zeichnen(); ftTelemetrieSync(w);
      scopeToast("STEP: " + schrittText(gg.schritt));
    }, function () {
      popOeffnen("step");
    });

    bindSmallEncoder("func", function (dir) {
      var cv = w.querySelector('canvas[data-knob="func"]');
      if (cv) { cv.dataset.ang = String((parseFloat(cv.dataset.ang || "-40") + dir * 28)); }
      var nv = ((MENU_STAND.nr || 0) + (dir > 0 ? 1 : 3)) % 4;
      MENU_STAND.nr = nv; menuStandSichern(); nrSetzen(nv); afSet("NR", nv > 0);
      zeichnen(); ftKnobsRedraw(w);
      scopeToast("DNR STUFE " + nv);
    }, function () {
      menuZeigen(true);
    });

    var dialEl = w.querySelector('[data-feld="dial"]');
    radBinden(dialEl, function (richtung) {
      if (Z.geraete[i].lockAn) { scopeToast("VFO GESPERRT (LOCK)"); return; }
      if (SCAN_STATE.aktiv) { scanStoppen(i); }
      var cv = w.querySelector('canvas[data-knob="vfo"]');
      if (cv) {
        cv.dataset.ang = String((parseFloat(cv.dataset.ang || "0") + richtung * 15) % 360);
        ftKnobsRedraw(w);
      }
      drehen(i, richtung);
    });

    g._smeter = bogenBauen(w.querySelector('[data-feld="smeter"]'), 29, 152, 50);
    bindenErweitert(w, i);
    griffBinden(w, g);
    resizeBinden(w, g);
    schliessenBinden(w, g);
    document.body.appendChild(w);
    resizeAnwenden(w, g);
    lichtAnwenden(lichtIdLesen(0), 0);
    ftTelemetrieSync(w);
    setTimeout(function () { scopeZeichnen(i, w, true); ftTelemetrieSync(w); }, 90);
    return w;
  }

  function bindenErweitert(w, i) {
    if (!w) { return; }
    var gGet = function () { return Z.geraete[i]; };
    var syncVfo = function (hzNeu, modNeu, txt) {
      var g2 = gGet();
      if (!g2) { return; }
      abstimmen(i, hzNeu, modNeu || g2.modus, txt);
    };

    Array.prototype.forEach.call(w.querySelectorAll("[data-ab]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var g2 = gGet();
        var oldHz = g2.hz, oldM = g2.modus;
        var neuHz = g2.b || oldHz, neuM = g2.bModus || oldM;
        g2.b = oldHz; g2.bModus = oldM;
        g2.vfoB = !g2.vfoB;
        Z.geraete.forEach(function (o, k) {
          if (k !== i) { o.b = oldHz; o.bModus = oldM; o.vfoB = g2.vfoB; }
        });
        syncVfo(neuHz, neuM, (g2.vfoB ? "VFO-B" : "VFO-A") + " aktiv");
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-rit]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        var g2 = gGet();
        if (g2.ritAn) {
          g2.ritAn = false;
          var ziel = g2.ritBasis || g2.hz;
          g2.ritOff = 0;
          Z.geraete.forEach(function (o) { o.ritAn = false; o.ritOff = 0; });
          syncVfo(ziel, null, "RIT / CLAR AUS");
        } else {
          g2.ritAn = true;
          g2.ritBasis = g2.hz;
          g2.ritOff = 0;
          Z.geraete.forEach(function (o) { o.ritAn = true; o.ritBasis = g2.hz; o.ritOff = 0; });
          g2.meldung = "RIT / CLAR EIN (Drehen = Feinversatz)";
          zeichnen();
        }
        setTimeout(function () { if (g2.meldung && g2.meldung.indexOf("RIT") >= 0) { g2.meldung = ""; zeichnen(); } }, 2000);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-split]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        var g2 = gGet();
        g2.splitAn = !g2.splitAn;
        Z.geraete.forEach(function (o) { o.splitAn = g2.splitAn; });
        g2.meldung = g2.splitAn ? "SPLIT-Monitor VFO-B" : "SPLIT AUS";
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-qmb]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var g2 = gGet();
        if (!g2.qmbHz || (Math.abs(g2.qmbHz - g2.hz) > 500 && !t.dataset.armed)) {
          g2.qmbHz = g2.hz; g2.qmbM = g2.modus;
          t.dataset.armed = "1";
          g2.meldung = "QMB gespeichert: " + hzKurz(g2.hz) + " MHz";
        } else {
          t.dataset.armed = "";
          syncVfo(g2.qmbHz, g2.qmbM, "QMB Abruf: " + hzKurz(g2.qmbHz) + " MHz");
        }
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 2000);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-cs]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var g2 = gGet();
        var nx = ((g2.sp || 0) + 1) % SPEICHER.length;
        var sp = SPEICHER[nx];
        g2.sp = nx;
        if (sp) { abstimmen(i, sp.hz, sp.m, sp.n); }
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-zin]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        var g2 = gGet();
        var r = Math.round(g2.hz / 1000) * 1000;
        syncVfo(r, null, "ZIN: " + hzKurz(r) + " MHz");
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1600);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-notch]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        var an = afSet("Notch", !afStateRead("Notch"));
        MENU_STAND.notch = an; menuStandSichern();
        var g2 = gGet();
        g2.meldung = "AUTO-NOTCH " + (an ? "EIN" : "AUS");
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-cont]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        var an = afSet("EQ", !afStateRead("EQ"));
        MENU_STAND.eq = an; menuStandSichern();
        var g2 = gGet();
        g2.meldung = "CONTOUR / EQ " + (an ? "EIN" : "AUS");
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-attbtn]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var vals = [0, 10, 20];
        MENU_STAND.att = vals[(vals.indexOf(MENU_STAND.att || 0) + 1) % vals.length];
        menuStandSichern();
        var g2 = gGet();
        g2.meldung = MENU_STAND.att ? ("ATT -" + MENU_STAND.att + " dB") : "ATT AUS";
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-ipobtn]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        MENU_STAND.pre = !MENU_STAND.pre; menuStandSichern();
        var g2 = gGet();
        g2.meldung = MENU_STAND.pre ? "PRE AMP2 EIN" : "IPO (Direkt)";
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-agcbtn]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var list = ["auto", "schnell", "mittel", "langsam", "aus"];
        MENU_STAND.agc = list[(list.indexOf(MENU_STAND.agc || "auto") + 1) % list.length];
        menuStandSichern();
        var g2 = gGet();
        g2.meldung = "AGC: " + String(MENU_STAND.agc).toUpperCase();
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-rxonly]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        var g2 = gGet();
        g2.meldung = t.textContent.replace(/\s+/g, " ").trim() + ": WebSDR ist reiner Empfänger";
        zeichnen();
        setTimeout(function () { g2.meldung = ""; zeichnen(); }, 1800);
      };
    });

    /* Allgemeine Tastenklicks fuer alle uebrigen Taster auf dem Pult */
    w.addEventListener("pointerdown", function (ev) {
      var bt = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (bt && !bt.dataset.ab && !bt.dataset.rit && !bt.dataset.split && !bt.dataset.qmb &&
          !bt.dataset.cs && !bt.dataset.zin && !bt.dataset.notch && !bt.dataset.cont &&
          !bt.dataset.attbtn && !bt.dataset.ipobtn && !bt.dataset.agcbtn && !bt.dataset.rxonly) {
        fgKlick("taste");
      }
    }, true);
  }

  /* [BAND ÜBER PROFIL] Liegt die Frequenz im laufenden Fenster, wird direkt
     abgestimmt. Sonst wird das passende ham_*-Profil geschaltet - so wie es
     der Receiver selbst macht. Gibt es keines, kommt eine klare Meldung. */
  function bandWaehlen(i, b) {
    var g = Z.geraete[i];
    if (!g) { return false; }
    if (g.lockAn) { g.meldung = "VFO GESPERRT (LOCK)"; zeichnen(); return false; }
    var p = profilFuerBand(b.n);
    var mWahl = bandModus(b.n, p ? p.textContent : "");
    var fz = fensterJetzt();
    var imFenster = fz && Math.abs(b.hz - fz.mitte) <= fz.halb;
    if (imFenster) {
      return abstimmen(i, b.hz, mWahl, b.n);
    }
    if (!p) {
      g.meldung = b.n + ": kein Profil vorhanden";
      zeichnen();
      setTimeout(function () { g.meldung = ""; zeichnen(); }, 2800);
      return false;
    }
    if (!profilWechseln(p.value)) { return false; }
    g.meldung = b.n + " · Profil wechselt …";
    zeichnen();
    setTimeout(function () {
      var fz2 = fensterJetzt();
      var drin = fz2 && Math.abs(b.hz - fz2.mitte) <= fz2.halb;
      if (drin) {
        abstimmen(i, b.hz, mWahl, b.n + " · " + profilKurz(p.textContent || p.text));
      } else {
        g.meldung = b.n + ": Profilwechsel gesperrt (Gastmodus)";
        zeichnen();
        setTimeout(function () { g.meldung = ""; zeichnen(); }, 3200);
      }
    }, 3200);
    return true;
  }

  /* [DREHEN] 20.11.2026
     Das Rad soll die Frequenz stellen - aber nur, wenn der Empfaenger sie
     ueberhaupt empfangen kann. Liegt die Gerätefrequenz (z.B. 14,195 MHz)
     ausserhalb des laufenden Fensters (30-32 MHz), kann das Drehen nichts
     bewirken. Frueher passierte dann stumm gar nichts - das sah nach
     "nicht verdrahtet" aus. Jetzt wird es gesagt. */
  function drehen(i, richtung) {
    var g = Z.geraete[i];
    if (!g) { return false; }
    if (g.lockAn) { g.meldung = "VFO GESPERRT (LOCK)"; zeichnen(); return false; }
    Z.aktiv = i;                                  /* dieses Gerät bedient jetzt */
    var ziel = g.hz + richtung * g.schritt;
    if (g.ritAn) {
      var neuOff = Math.max(-9990, Math.min(9990, (g.ritOff || 0) + richtung * g.schritt));
      g.ritOff = neuOff;
      Z.geraete.forEach(function (o) { o.ritOff = neuOff; });
      ziel = (g.ritBasis || g.hz) + neuOff;
    }
    var fz = fensterJetzt();
    if (fz && Math.abs(ziel - fz.mitte) > fz.halb) {
      /* ausserhalb: erst gar nicht die Anzeige verstellen */
      g.meldung = hzKurz(g.hz) + " MHz · nicht im Empfangsfenster";
      zeichnen();
      setTimeout(function () { g.meldung = ""; zeichnen(); }, 2400);
      return false;
    }
    return abstimmen(i, ziel, null, null);
  }

  /* ================= Beide Geräte folgen dem Empfänger ==================
     [VERDRAHTUNG] 20.11.2026
     Bisher war der Weg nur einseitig: Gerät -> Empfänger. Drehte man am
     Receiver selbst (oder wechselte das Profil), blieben die Geräte auf
     ihrer alten Frequenz stehen. Jetzt wird der Empfänger mitgeschrieben:
     ändert sich seine Frequenz von außen, übernehmen BEIDE Geräte sie -
     sofern sie nicht gerade selbst bedient werden. */
  var MITSCHRIFT = { hz: 0, modus: "", t: 0 };
  function empfangenModusLesen() {
    try {
      /* Der Receiver markiert den laufenden Knopf mit "highlighted" bzw.
         "dnx-mode-current" - nicht mit "checked" (live nachgemessen). */
      var b = document.querySelector(".openwebrx-demodulator-button.highlighted") ||
              document.querySelector(".openwebrx-demodulator-button.dnx-mode-current") ||
              document.querySelector(".openwebrx-demodulator-button.checked") ||
              document.querySelector(".openwebrx-demodulator-button.active");
      if (b) { return String(b.getAttribute("data-modulation") || b.textContent || "").trim().toLowerCase(); }
      if (typeof UI !== "undefined" && typeof UI.getModulation === "function") {
        return String(UI.getModulation() || "").toLowerCase();
      }
      if (typeof active_modulation !== "undefined" && active_modulation) { return String(active_modulation); }
    } catch (e) { }
    return "";
  }
  function mitlaufen() {
    try {
      var hz = empfangenLesen();
      var md = empfangenModusLesen();
      if (!hz) { return; }
      var jetzt = Date.now();
      /* Nur reagieren, wenn sich wirklich etwas geaendert hat */
      var vNow = volProzent();
      if (hz === MITSCHRIFT.hz && md === MITSCHRIFT.modus && vNow === MITSCHRIFT._vol) { return; }
      MITSCHRIFT._vol = vNow;
      if (hz === MITSCHRIFT.hz && md === MITSCHRIFT.modus) {
        if (FENSTER[0]) { ftTelemetrieSync(FENSTER[0]); }
        if (FENSTER[1]) { tsTelemetrieSync(FENSTER[1]); }
        if (FENSTER[2]) { icTelemetrieSync(FENSTER[2]); }
        return;
      }
      var ersterDurchlauf = (MITSCHRIFT.hz === 0);
      MITSCHRIFT.hz = hz;
      MITSCHRIFT.modus = md;
      MITSCHRIFT.t = jetzt;
      if (ersterDurchlauf) {
        var syncInit = false;
        Z.geraete.forEach(function (g) {
          if (!imFenster(g.hz)) {
            g.hz = hz;
            if (md) {
              var m0 = md.toUpperCase();
              if (m0 === "DATA") { m0 = "USB"; }
              if (m0 === "NFM") { m0 = "FM"; }
              if (MODI.indexOf(m0) >= 0) { g.modus = m0; }
            }
            syncInit = true;
          }
        });
        if (syncInit) { sichern(); zeichnen(); }
        return;
      }
      var geaendert = false;
      Z.geraete.forEach(function (g) {
        if (g.hz !== hz) { g.hz = hz; geaendert = true; }
        if (md) {
          var m = md.toUpperCase();
          if (m === "DATA") { m = "USB"; }
          if (m === "NFM") { m = "FM"; }
          if (MODI.indexOf(m) >= 0 && g.modus !== m) { g.modus = m; geaendert = true; }
        }
      });
      if (geaendert) { zeichnen(); }
    } catch (e) { }
  }

  function bandModus(name, optText) {
    if (optText) {
      var mMatch = String(optText).match(/\|\s*(USB|LSB|CW|AM|WFM|NFM|FM)\b/i);
      if (mMatch) {
        var mm = mMatch[1].toUpperCase();
        return (mm === "NFM") ? "FM" : mm;
      }
    }
    if (name === "4 m" || name === "2 m" || name === "70 cm") { return "FM"; }
    if (name === "2200 m" || name === "630 m" || name === "30 m" || name === "ULF") { return "CW"; }
    if (name === "160 m" || name === "80 m" || name === "40 m") { return "LSB"; }
    return "USB";
  }

  var EINGABE = ["", "", ""];

  function tasteV1(i, z) {
    if (z === "." && EINGABE[i].indexOf(".") >= 0) { return; }
    if (z === "." && !EINGABE[i]) { EINGABE[i] = "0"; }
    if (EINGABE[i].length >= 11) { return; }
    EINGABE[i] += z;
    zeichnen();
  }
  function enterV1(i) {
    var hz = eingabeHz(EINGABE[i]);
    var g = Z.geraete[i];
    if (!hz) { EINGABE[i] = ""; zeichnen(); return; }
    EINGABE[i] = "";
    if (!abstimmen(i, hz, null, hzKurz(hz) + " MHz")) {
      g.eingabe = "";
    }
    zeichnen();
  }

  /* ================= Vorlage 2 (Kenwood TS-890S: FUNKGERÄT 2) ========= */
  var TS_IMG_URL = "static/plugins/receiver/funkgeraet2_ts890_v822.png?v=822";
  var TS_W0 = 598, TS_H0 = 234;

  function tsBox(x0, y0, x1, y1) {
    return "left:" + (x0 * 100 / TS_W0).toFixed(3) + "%;top:" + (y0 * 100 / TS_H0).toFixed(3) +
           "%;width:" + ((x1 - x0) * 100 / TS_W0).toFixed(3) + "%;height:" + ((y1 - y0) * 100 / TS_H0).toFixed(3) + "%;";
  }
  function tsKnobBox(cx, cy, r) {
    return tsBox(cx - r, cy - r, cx + r, cy + r);
  }

  function tsKnobsRedraw(w, farbe) {
    if (!w) { return; }
    var f = farbe || lichtObj(lichtIdLesen(1));
    var hex = f.aus ? "#64748b" : f.hex;
    var rgb = f.aus ? "100,116,139" : f.rgb;

    Array.prototype.forEach.call(w.querySelectorAll("canvas.ts-knob-cv"), function (cv) {
      var ang = parseFloat(cv.dataset.ang || "0") || 0;
      var istVfo = (cv.dataset.knob === "vfo");
      var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      var rect = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
      var cssW = Math.max(cv.clientWidth || (istVfo ? 108 : 30), (rect && rect.width > 12) ? rect.width : 0);
      var px = Math.max(20, Math.round(cssW * dpr));
      if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
      var ctx = cv.getContext("2d");
      if (!ctx) { return; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      var r = px / 2;
      var rad = (ang - 90) * Math.PI / 180;

      if (istVfo) {
        /* Dezenter Leuchtring um das TS-890S Abstimmrad + klare rotierende Delle/Marke */
        if (!f.aus) {
          ctx.beginPath();
          ctx.arc(r, r, r - 1.4 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(" + rgb + ",0.38)";
          ctx.lineWidth = Math.max(1.8, 2.0 * dpr);
          ctx.stroke();
        }
        var dx = r + Math.cos(rad) * r * 0.56;
        var dy = r + Math.sin(rad) * r * 0.56;
        ctx.beginPath();
        ctx.arc(dx, dy, Math.max(2.8, 3.2 * dpr), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,18,0.68)";
        ctx.fill();
        ctx.strokeStyle = f.aus ? "rgba(226,232,240,0.45)" : "rgba(" + rgb + ",0.82)";
        ctx.lineWidth = Math.max(1.1, 1.2 * dpr);
        ctx.stroke();

        var vx0 = r + Math.cos(rad) * r * 0.78;
        var vy0 = r + Math.sin(rad) * r * 0.78;
        var vx1 = r + Math.cos(rad) * r * 0.93;
        var vy1 = r + Math.sin(rad) * r * 0.93;
        ctx.beginPath();
        ctx.moveTo(vx0, vy0);
        ctx.lineTo(vx1, vy1);
        ctx.strokeStyle = f.aus ? "rgba(226,232,240,0.85)" : hex;
        ctx.lineWidth = Math.max(2.0, 2.2 * dpr);
        ctx.lineCap = "round";
        ctx.stroke();
        return;
      }

      var x0 = r + Math.cos(rad) * r * 0.30;
      var y0 = r + Math.sin(rad) * r * 0.30;
      var x1 = r + Math.cos(rad) * r * 0.72;
      var y1 = r + Math.sin(rad) * r * 0.72;
      if (!f.aus) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = "rgba(" + rgb + ",0.58)";
        ctx.lineWidth = Math.max(2.5, 2.8 * dpr);
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = f.aus ? "rgba(241,245,249,0.9)" : "#ffffff";
      ctx.lineWidth = Math.max(1.25, 1.35 * dpr);
      ctx.lineCap = "round";
      ctx.stroke();
    });
  }

  function tsTelemetrieSync(w) {
    if (!w) { return; }
    var v = volProzent();
    var sqV = (typeof MENU_STAND.squelch === "number") ? MENU_STAND.squelch : -150;
    var rfV = (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf;
    var sqTxt = (sqV <= -149) ? "AUS" : (sqV + "dB");
    var rfTxt = (_rfState.modus === "auto") ? "AGC" : (rfV + "dB");

    var bVol = w.querySelector('[data-feld="tvol"]');
    var bSq  = w.querySelector('[data-feld="tsq"]');
    var bRf  = w.querySelector('[data-feld="trf"]');
    if (bVol) { bVol.textContent = "VOL " + v + "%"; }
    if (bSq)  { bSq.textContent  = "SQ " + sqTxt; bSq.classList.toggle("an", sqV > -149); }
    if (bRf)  { bRf.textContent  = "RF " + rfTxt; bRf.classList.toggle("an", _rfState.modus !== "auto"); }

    var afCv = w.querySelector('canvas[data-knob="af"]');
    if (afCv) {
      var afIsRf = (afCv.dataset.mode === "rf");
      var normAf = afIsRf ? ((rfV - RF_MIN) / Math.max(1, RF_MAX - RF_MIN)) : (v / 150);
      afCv.dataset.ang = String(-135 + Math.max(0, Math.min(1, normAf)) * 270);
    }
    var sqCv = w.querySelector('canvas[data-knob="sql"]');
    if (sqCv) {
      sqCv.dataset.ang = String(-135 + Math.max(0, Math.min(1, (sqV + 150) / 150)) * 270);
    }
    var stCv = w.querySelector('canvas[data-knob="mult"]');
    if (stCv) {
      var g1 = Z.geraete[1] || {};
      var sIdx = Math.max(0, SCHRITTE.indexOf(g1.schritt || 100));
      stCv.dataset.ang = String(-115 + (sIdx / Math.max(1, SCHRITTE.length - 1)) * 230);
    }
    var shCv = w.querySelector('canvas[data-knob="shft"]');
    if (shCv) {
      var bwL = [3000, 2400, 1800, 500];
      var bIdx = Math.max(0, bwL.indexOf(MENU_STAND.filt || 2400));
      shCv.dataset.ang = String(-105 + (bIdx / 3) * 210);
    }
    var micCv = w.querySelector('canvas[data-knob="mic"]');
    if (micCv) {
      var attL = [0, 10, 20];
      var aIdx = Math.max(0, attL.indexOf(MENU_STAND.att || 0));
      micCv.dataset.ang = String(-90 + aIdx * 90);
    }
    var keyCv = w.querySelector('canvas[data-knob="key"]');
    if (keyCv) {
      keyCv.dataset.ang = String(-105 + ((MENU_STAND.nr || 0) / 3) * 210);
    }
    tsKnobsRedraw(w, lichtObj(lichtIdLesen(1)));

    var pop = w.querySelector('[data-tspop="level"]');
    if (pop && pop.classList.contains("offen")) {
      var rVol = pop.querySelector('[data-lvl="vol"]'), lVol = pop.querySelector('[data-lvlval="vol"]');
      if (rVol) { rVol.value = String(v); } if (lVol) { lVol.textContent = v + " %"; }
      var rSq = pop.querySelector('[data-lvl="sq"]'), lSq = pop.querySelector('[data-lvlval="sq"]');
      if (rSq) { rSq.value = String(sqV); } if (lSq) { lSq.textContent = (sqV <= -149) ? "AUS" : (sqV + " dB"); }
      var rRf = pop.querySelector('[data-lvl="rf"]'), lRf = pop.querySelector('[data-lvlval="rf"]');
      if (rRf) { rRf.value = String(rfV); } if (lRf) { lRf.textContent = rfTxt; }
      var bTon = pop.querySelector('[data-ton="1"]');
      if (bTon) { bTon.classList.toggle("an", !!MENU_STAND.ton); }
    }
  }

  function bauenV2(i) {
    var g = Z.geraete[i];
    var w = document.createElement("div");
    w.className = "fgw fg-w2";
    w.id = "fg-geraet-" + i;

    scopeCfgLaden();
    if (!SCOPE.mode2) { SCOPE.mode2 = "std"; }
    fftHookInstallieren();

    var pbSvg2 =
      '<svg class="ts-pb-svg" viewBox="0 0 120 14" preserveAspectRatio="none">' +
        '<line x1="2" y1="12" x2="118" y2="12" stroke="#94a3b8" stroke-width="0.9"/>' +
        '<path data-pb="1" d="M 32 12 L 37 2 L 88 2 L 93 12" fill="rgba(56,189,248,.18)" stroke="#f1f5f9" stroke-width="1.1"/>' +
        '<rect data-pbbar="1" x="52" y="2.5" width="18" height="9.5" fill="rgba(186,230,253,.32)"/>' +
      '</svg>';

    var ledSvg =
      '<svg class="ts-photo-svg" viewBox="0 0 598 234" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect data-ts-pwrled="1" x="18.5" y="23.2" width="12.5" height="2.2" rx="1.0" fill="#22c55e"/>' +
        '<rect data-ts-txled="1" x="355.0" y="12.0" width="14.0" height="3.2" rx="1.1" fill="#15803d"/>' +
        '<rect data-ts-splled="1" x="405.5" y="42.2" width="12.0" height="2.1" rx="0.9" fill="#1e293b"/>' +
        '<circle data-ts-recled="1" cx="334.5" cy="106.5" r="1.4" fill="#2b1616"/>' +
      '</svg>';

    var padHtml = "";
    ["1","2","3","4","5","6","7","8","9",".","0","C"].forEach(function (k) {
      if (k === "C") {
        padHtml += '<button type="button" class="ts-pad-clr" data-tat="klar">CLR</button>';
      } else {
        padHtml += '<button type="button" data-ziffer="' + k + '">' + k + '</button>';
      }
    });

    /* Tastatur-/Bandmatrix 3x5 exakt auf den echten Tasten des TS-890S */
    var keyMatrix = [
      [{ l: "RX ANT", act: "ipo" }, { l: "DRV", act: "att" }, { l: "GENE", act: "bandpop" }],
      [{ l: "1.8", b: "160 m", z: "1" }, { l: "3.5", b: "80 m", z: "2" }, { l: "7", b: "40 m", z: "3" }],
      [{ l: "10", b: "30 m", z: "4" }, { l: "14", b: "20 m", z: "5" }, { l: "18", b: "17 m", z: "6" }],
      [{ l: "21", b: "15 m", z: "7" }, { l: "24", b: "12 m", z: "8" }, { l: "28", b: "10 m", z: "9" }],
      [{ l: "CLR", act: "klar" }, { l: "50", b: "6 m", z: "0" }, { l: "ENT", act: "enter" }]
    ];
    var kxCols = [329.0, 353.0, 377.0];
    var kyRows = [25.5, 40.5, 55.5, 70.5, 85.5];
    var matrixSpots = "";
    keyMatrix.forEach(function (row, ri) {
      row.forEach(function (cell, ci) {
        var st = tsBox(kxCols[ci], kyRows[ri], kxCols[ci] + 19.0, kyRows[ri] + 11.0);
        if (cell.b) {
          matrixSpots += '<button type="button" class="ts-spot ts-spot-key" style="' + st + '" data-ts-keyband="' + cell.b + '" data-ts-keydig="' + cell.z + '" title="' + cell.l + ' MHz (' + cell.b + ') / im Eingabe-Modus Ziffer ' + cell.z + '"></button>';
        } else if (cell.act === "ipo") {
          matrixSpots += '<button type="button" class="ts-spot ts-spot-key" style="' + st + '" data-ipobtn="1" title="RX ANT / Vorverstärker (PRE/IPO)"></button>';
        } else if (cell.act === "att") {
          matrixSpots += '<button type="button" class="ts-spot ts-spot-key" style="' + st + '" data-attbtn="1" title="DRV / Eingangsdämpfer (ATT)"></button>';
        } else if (cell.act === "bandpop") {
          matrixSpots += '<button type="button" class="ts-spot ts-spot-key" style="' + st + '" data-tspopopen="band" title="GENE: Alle 17 HAM-Bänder + ULF + Profile"></button>';
        } else if (cell.act === "klar") {
          matrixSpots += '<button type="button" class="ts-spot ts-spot-key" style="' + st + '" data-tat="klar" title="CLR: Eingabe löschen"></button>';
        } else if (cell.act === "enter") {
          matrixSpots += '<button type="button" class="ts-spot ts-spot-key" style="' + st + '" data-tat="enter" title="ENT: Frequenzeingabe öffnen / übernehmen"></button>';
        }
      });
    });

    w.innerHTML =
      '<div class="ts-shell">' +
        '<div class="ts-stage">' +
          '<div class="ts-chassis" data-griff title="Funkgerät 2 verschieben">' +
            '<img class="ts-photo" src="' + TS_IMG_URL + '" alt="Funkgerät 2" draggable="false">' +
            ledSvg +

            /* 1. Schlanke Top-Bezel-Leiste (zwischen KENWOOD & BUSY/TX): VOL · SQ · RF · COLOR · DW · SCAN · MENUE */
            '<div class="ts-lid-bar" style="' + tsBox(132.0, 2.5, 342.0, 16.0) + '">' +
              '<button type="button" class="ts-tpill" data-tpill="vol" data-feld="tvol" title="Lautstärke 0–150% (Mausrad / Klick / Doppelklick=Stumm)">VOL 100%</button>' +
              '<button type="button" class="ts-tpill" data-tpill="sq" data-feld="tsq" title="Squelch (Mausrad / Klick=Reset)">SQ AUS</button>' +
              '<button type="button" class="ts-tpill" data-tpill="rf" data-feld="trf" title="RF-Gain (Mausrad / Klick)">RF 20dB</button>' +
              '<button type="button" class="ts-tbtn" data-tat="color2" title="Tasten- & Beleuchtungsfarbe wechseln"><i data-feld="lichtpunkt"></i><em data-feld="lichtname">CYAN</em></button>' +
              '<button type="button" class="ts-tbtn" data-tat="dw" title="Dual Watch: VFO-A & VFO-B">DW</button>' +
              '<button type="button" class="ts-tbtn" data-tat="scan" title="Suchlauf starten/stoppen">SCN</button>' +
              '<button type="button" class="ts-tbtn ts-tmenu" data-tat="menu" title="Geräte-Menü öffnen">☰</button>' +
            '</div>' +

            /* 2. Echtes Kenwood 7"-TFT-Glas (64.5..286.5 x 31.5..163.5) */
            '<div class="ts-screen-slot" style="' + tsBox(64.5, 31.5, 286.5, 163.5) + '">' +
              '<div class="ts-scr-hd">' +
                '<button type="button" class="ts-hd-tag" data-agcbtn="1" title="AGC-Regelung">AGC:<em data-feld="agcval">AUTO</em></button>' +
                '<button type="button" class="ts-hd-tag" data-ipobtn="1" title="Vorverstärker / IPO">PRE:<em data-feld="ipoval">AMP2</em></button>' +
                '<button type="button" class="ts-hd-tag" data-attbtn="1" title="Eingangsdämpfer">ATT:<em data-feld="attval">OFF</em></button>' +
                '<button type="button" class="ts-hd-tag" data-nar="1" title="ZF-Filterbreite">FIL:<em data-feld="rfilval">2.4k</em></button>' +
                '<span class="ts-ind-tags"><i data-ind="dw">DW</i><i data-ind="scn">SCN</i><i data-ind="lck">LCK</i></span>' +
                '<button type="button" class="ts-lvl-btn" data-tspopopen="level" title="Audio · SQ · RF · DSP einstellen">LVL</button>' +
              '</div>' +

              '<div class="ts-scr-top">' +
                '<div class="ts-meter-wrap">' +
                  '<i class="ts-meter-pk" data-feld="meterpk" aria-hidden="true"></i>' +
                  '<div class="ts-meter" data-feld="smeter"></div>' +
                  '<span class="ts-db-pill" data-feld="db">—</span>' +
                '</div>' +
                '<div class="ts-vfo-col">' +
                  '<div class="ts-vfoa-row">' +
                    '<button type="button" class="ts-mode-badge" data-tspopopen="mode" data-feld="modus" title="Betriebsart wählen">CW</button>' +
                    '<button type="button" class="ts-freq" data-tspopopen="pad" data-feld="freq" title="Klick für Direkteingabe">0<small>Hz</small></button>' +
                  '</div>' +
                  '<div class="ts-vfob-row">' +
                    '<button type="button" class="ts-vfo-tag" data-ab="1" data-feld="vfotag" title="VFO-A ↔ VFO-B tauschen">VFO-B</button>' +
                    '<button type="button" class="ts-subb" data-ab="1" data-feld="freqb2">0<small>Hz</small></button>' +
                    '<button type="button" class="ts-step-tag" data-tspopopen="step" data-feld="schritt" title="Abstimmschritt wählen">100 Hz</button>' +
                  '</div>' +
                  '<div class="ts-pb-row">' +
                    pbSvg2 +
                    '<button type="button" class="ts-scope-info" data-tspopopen="wfopt" data-feld="scopeinfo" title="Wasserfall-Optionen"><b>2D</b> · FAST2 · FULL ▾</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="ts-scr-scope' + (SCOPE.expand ? " expand" : "") + '">' +
                '<canvas class="ts-scope-cv" data-feld="w2scope" title="Klick im Spektrum stimmt sofort ab"></canvas>' +
                '<div class="ts-scope-axis">' +
                  '<span data-feld="sf0">-200k</span><span data-feld="sf1">-100k</span>' +
                  '<span class="mid" data-feld="scopefreq">29.200.000</span>' +
                  '<span data-feld="sf3">+100k</span><span data-feld="sf4">+200k</span>' +
                '</div>' +
              '</div>' +

              '<div class="ts-scr-meta">' +
                '<span data-feld="meta">CW · FIL 2,4 kHz · 100 Hz</span>' +
                '<span class="ts-status-msg" data-feld="status">BEREIT</span>' +
              '</div>' +

              '<div class="ts-softkeys">' +
                '<button type="button" data-ts-sk="center" title="F1: Scope zentrieren">F1 CTR</button>' +
                '<button type="button" data-ts-sk="smode" title="F2: 2D / 3D / MULTI umschalten">F2 2D</button>' +
                '<button type="button" data-ts-sk="span" title="F3: Spanne wechseln">F3 SPN</button>' +
                '<button type="button" data-ts-sk="speed" title="F4: Wasserfall-Tempo">F4 SPD</button>' +
                '<button type="button" data-ts-sk="expand" title="F5: Scope vergrößern">F5 EXP</button>' +
                '<button type="button" data-tspopopen="mem" title="F6: Speicherkanäle">F6 MEM</button>' +
                '<button type="button" data-tspopopen="band" title="F7: Alle HAM-Bänder">F7 BND</button>' +
              '</div>' +

              /* Rechte vertikale S1..S6 Softkey-Fahnen direkt neben den 6 Gehaeuse-Pfeilen ◀ */
              '<div class="ts-srail">' +
                '<button type="button" data-ipobtn="1" title="S1: PRE / IPO">PRE</button>' +
                '<button type="button" data-attbtn="1" title="S2: ATT">ATT</button>' +
                '<button type="button" data-nar="1" title="S3: IF Filter">FIL</button>' +
                '<button type="button" data-tat="dw" title="S4: Dual Watch">DW</button>' +
                '<button type="button" data-tat="scan" title="S5: Scan">SCN</button>' +
                '<button type="button" data-agcbtn="1" title="S6: AGC">AGC</button>' +
              '</div>' +

              /* --- 7 Inline-Overlays innerhalb des TS-890S TFTs --- */
              '<div class="ts-pop" data-tspop="level">' +
                '<div class="ts-pop-hd"><span>AUDIO · SQ · RF-GAIN · DSP</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-lvl-grid">' +
                  '<label class="ts-lvl-row"><b>VOL</b><input type="range" data-lvl="vol" min="0" max="150" step="1"><em data-lvlval="vol">100 %</em></label>' +
                  '<label class="ts-lvl-row"><b>SQ</b><input type="range" data-lvl="sq" min="-150" max="0" step="1"><em data-lvlval="sq">AUS</em></label>' +
                  '<label class="ts-lvl-row"><b>RF</b><input type="range" data-lvl="rf" min="' + RF_MIN + '" max="' + RF_MAX + '" step="1"><em data-lvlval="rf">20 dB</em></label>' +
                  '<div class="ts-lvl-btns">' +
                    '<button type="button" data-asc="1" title="Auto-Squelch umschalten">ASC</button>' +
                    '<button type="button" data-nb="1" title="Noise Blanker">NB</button>' +
                    '<button type="button" data-dnr="1" title="Digital Noise Reduction">NR</button>' +
                    '<button type="button" data-notch="1" title="Auto-Notch">NCH</button>' +
                    '<button type="button" data-cont="1" title="Contour / Audio-EQ">EQ</button>' +
                    '<button type="button" data-ton="1" title="Bedienton (Klick) ein/aus">TON</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="ts-pop" data-tspop="wfopt">' +
                '<div class="ts-pop-hd"><span>BANDSCOPE &amp; WASSERFALL</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-wf-opts">' +
                  '<div class="ts-wf-grp"><b>ANSICHT (GERÄT 2)</b><div>' +
                    '<button type="button" data-tswfmode="std">2D BANDSCOPE</button>' +
                    '<button type="button" data-tswfmode="3d">3D (3DSS)</button>' +
                    '<button type="button" data-tswfmode="multi">MULTI</button>' +
                  '</div></div>' +
                  '<div class="ts-wf-grp"><b>FARBPALETTE</b><div>' +
                    '<button type="button" data-tswfpal="ft710">BLAU-ROT</button>' +
                    '<button type="button" data-tswfpal="owrx">OWRX</button>' +
                    '<button type="button" data-tswfpal="feuer">FEUER</button>' +
                    '<button type="button" data-tswfpal="eis">EIS</button>' +
                    '<button type="button" data-tswfpal="gruen">GRÜN</button>' +
                  '</div></div>' +
                  '<div class="ts-wf-grp"><b>FLUSS &amp; EXTRAS</b><div>' +
                    '<button type="button" data-tswftog="wfdir" data-feld="wfdirbtn">FLUSS: ABWÄRTS</button>' +
                    '<button type="button" data-tswftog="peak">PEAK-HOLD</button>' +
                    '<button type="button" data-tswftog="auto">AUTO-PEGEL</button>' +
                    '<button type="button" data-ts-sk="center">CENTER</button>' +
                    '<button type="button" data-ts-sk="expand">EXPAND</button>' +
                  '</div></div>' +
                  '<div class="ts-wf-grp"><b>SPAN / TEMPO</b><div>' +
                    '<button type="button" data-ts-sk="span" data-feld="wfspanbtn">SPAN: FULL</button>' +
                    '<button type="button" data-ts-sk="speed" data-feld="wfspdbtn">TEMPO: FAST2</button>' +
                  '</div></div>' +
                '</div>' +
              '</div>' +

              '<div class="ts-pop" data-tspop="band">' +
                '<div class="ts-pop-hd"><span>HAM-BÄNDER &amp; PROFILE</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-pop-grid g5">' +
                  BAENDER.map(function (b) {
                    return '<button type="button" data-band="' + b.n + '">' + b.n + '</button>';
                  }).join("") +
                '</div>' +
                '<button type="button" class="ts-pop-allprof" data-tsopenprof="1">Alle Empfangsprofile im Menü öffnen ▸</button>' +
              '</div>' +

              '<div class="ts-pop" data-tspop="mode">' +
                '<div class="ts-pop-hd"><span>BETRIEBSART WÄHLEN</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-pop-grid g3">' +
                  MODI.map(function (m) {
                    return '<button type="button" data-modus="' + m + '">' + m + '</button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ts-pop" data-tspop="mem">' +
                '<div class="ts-pop-hd"><span>SPEICHERKANÄLE</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-pop-list">' +
                  SPEICHER.map(function (sp, idx) {
                    return '<button type="button" data-mem="' + idx + '"><b>' + sp.n + '</b><span>' + hzKurz(sp.hz) + ' MHz · ' + sp.m + '</span></button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ts-pop" data-tspop="step">' +
                '<div class="ts-pop-hd"><span>ABSTIMMSCHRITT</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-pop-grid g3">' +
                  SCHRITTE.map(function (st) {
                    return '<button type="button" data-step="' + st + '">' + schrittText(st) + '</button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ts-pop" data-tspop="pad">' +
                '<div class="ts-pop-hd"><span>FREQUENZ EINGEBEN</span><button type="button" data-tspopx>×</button></div>' +
                '<div class="ts-pad-disp"><span data-feld="eingabe">—</span><small>MHz (.) / kHz</small></div>' +
                '<div class="ts-pad-grid">' +
                  padHtml +
                  '<button type="button" class="ts-pad-ent" data-tat="enter">ENT (ÜBERNEHMEN)</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            /* 3. Linke Spalte: POWER, PF A, VOX, SEND, AT, PHONES, PADDLE, USB, MIC */
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(12.0, 22.0, 38.5, 34.0) + '" data-tat="pwr" title="VFO-Sperre (LOCK) / Shift+Klick = Display dimmen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(12.0, 39.5, 24.5, 50.0) + '" data-tat="color2" title="PF A: Beleuchtungsfarbe wechseln"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(26.5, 39.5, 39.0, 50.0) + '" data-rxonly="1" title="VOX (WebSDR: reiner Empfänger)"> </button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(12.0, 55.5, 38.5, 67.5) + '" data-rxonly="1" title="SEND (WebSDR: reiner Empfänger)"> </button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(12.0, 71.5, 38.5, 83.5) + '" data-rxonly="1" title="AT Tuner (WebSDR: reiner Empfänger)"> </button>' +
            '<button type="button" class="ts-spot ts-spot-jack" style="' + tsBox(13.0, 94.0, 37.5, 117.0) + '" data-tspopopen="level" title="PHONES: Lautstärke · SQ · RF-Gain"></button>' +
            '<button type="button" class="ts-spot ts-spot-jack" style="' + tsBox(13.0, 125.0, 37.5, 148.0) + '" data-tspopopen="step" title="PADDLE: Abstimmschritt"></button>' +
            '<button type="button" class="ts-spot ts-spot-jack" style="' + tsBox(13.5, 151.0, 37.5, 165.0) + '" data-tspopopen="mem" title="USB: Speicherkanäle"></button>' +
            '<button type="button" class="ts-spot ts-spot-jack" style="' + tsBox(11.5, 174.0, 39.0, 202.0) + '" data-tat="menu" title="MIC / Menü öffnen"></button>' +

            /* 4. Untere Leiste unter dem TFT: ESC, F1..F7, AF/SCP, MHz */
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(45.5, 181.0, 62.5, 194.5) + '" data-tat="esc" title="ESC: Popover schließen / Eingabe löschen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(68.0, 173.5, 92.5, 195.0) + '" data-ts-sk="center" title="F1: Scope zentrieren"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(98.0, 173.5, 122.5, 195.0) + '" data-ts-sk="smode" title="F2: 2D / 3D / MULTI umschalten"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(128.0, 173.5, 152.5, 195.0) + '" data-ts-sk="span" title="F3: Scope-Spanne wechseln"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(158.0, 173.5, 182.5, 195.0) + '" data-ts-sk="speed" title="F4: Wasserfall-Tempo"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(188.0, 173.5, 212.5, 195.0) + '" data-ts-sk="expand" title="F5: Bandscope vergrößern"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(218.0, 173.5, 242.5, 195.0) + '" data-tspopopen="mem" title="F6: Speicherkanäle"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(248.0, 173.5, 272.5, 195.0) + '" data-tspopopen="band" title="F7: Alle HAM-Bänder & Profile"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(282.0, 181.0, 296.0, 194.5) + '" data-tspopopen="wfopt" title="AF/SCP: Bandscope & Wasserfall-Optionen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(299.0, 181.0, 314.0, 194.5) + '" data-tspopopen="pad" title="MHz: Frequenz-Direkteingabe"></button>' +

            /* 5. 6 vertikale Softkeys rechts vom Display (S1..S6) */
            '<button type="button" class="ts-spot ts-spot-key ts-spot-s" style="' + tsBox(294.5, 38.0, 316.0, 49.5) + '" data-ipobtn="1" title="S1: Vorverstärker (PRE/IPO)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key ts-spot-s" style="' + tsBox(294.5, 59.0, 316.0, 70.5) + '" data-attbtn="1" title="S2: Eingangsdämpfer (ATT)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key ts-spot-s" style="' + tsBox(294.5, 80.0, 316.0, 91.5) + '" data-nar="1" title="S3: ZF-Filterbreite"></button>' +
            '<button type="button" class="ts-spot ts-spot-key ts-spot-s" style="' + tsBox(294.5, 101.0, 316.0, 112.5) + '" data-tat="dw" title="S4: Dual Watch (DW)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key ts-spot-s" style="' + tsBox(294.5, 122.0, 316.0, 133.5) + '" data-tat="scan" title="S5: Suchlauf (SCAN)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key ts-spot-s" style="' + tsBox(294.5, 143.0, 316.0, 154.5) + '" data-agcbtn="1" title="S6: AGC-Regelung"></button>' +

            /* 6. Band-/Ziffernblock 3x5 + Recorder + Modus-Spalte */
            matrixSpots +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(329.0, 102.0, 342.5, 110.5) + '" data-tat="mute" title="REC: Audio Stumm / Ein"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(344.5, 102.0, 358.0, 110.5) + '" data-tat="stopall" title="STOP: DW & Scan stoppen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(360.0, 102.0, 373.5, 110.5) + '" data-tspopopen="mem" title="PLAY: Speicherkanäle"></button>' +

            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(329.5, 119.0, 348.0, 130.5) + '" data-tsmode="LSB/USB" title="LSB ↔ USB umschalten"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(329.5, 135.5, 348.0, 147.0) + '" data-tsmode="CW" title="CW einstellen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(329.5, 152.0, 348.0, 163.5) + '" data-tsmode="DATA" title="FSK/PSK / DATA"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(329.5, 168.5, 348.0, 180.0) + '" data-tsmode="FM/AM" title="FM ↔ AM umschalten"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(329.5, 185.0, 348.0, 196.5) + '" data-tspopopen="mode" title="Alle Betriebsarten (WFM / USB / LSB / CW / FM / AM / DATA)"></button>' +

            /* 7. VFO-Cluster + MENU / TF-SET / Filter */
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(405.0, 25.5, 424.0, 36.5) + '" data-tat="color2" title="PF B: Beleuchtungsfarbe wechseln"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(429.0, 25.5, 448.0, 36.5) + '" data-tat="dw" title="PF C: Dual Watch (DW)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(405.0, 40.5, 424.0, 51.5) + '" data-split="1" title="SPLIT ein/aus"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(429.0, 40.5, 448.0, 51.5) + '" data-lock2="1" title="LOCK: VFO sperren/entsperren"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(405.0, 55.5, 424.0, 66.5) + '" data-tspopopen="mem" title="M/V: Speicherkanäle"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(429.0, 55.5, 448.0, 66.5) + '" data-qmb="1" title="M.IN: Schnellspeicher merken/abrufen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(404.0, 70.5, 425.0, 81.5) + '" data-cs="1" title="Q-M.IN: Nächster Speicherkanal"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(428.0, 70.5, 449.0, 81.5) + '" data-tat="scan" title="Q-MR: Suchlauf (SCAN)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(405.0, 85.5, 424.0, 96.5) + '" data-ab="1" title="A/B: VFO-A ↔ VFO-B"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(429.0, 85.5, 448.0, 96.5) + '" data-tspopopen="band" title="▼: Bänder & Profile"></button>' +

            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(454.0, 86.0, 476.0, 97.0) + '" data-tat="menu" title="MENU: Geräte-Menü öffnen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(454.0, 104.5, 476.0, 119.5) + '" data-tspopopen="wfopt" title="TF-SET: Bandscope & Wasserfall-Optionen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(457.0, 134.0, 475.5, 145.0) + '" data-zin="1" title="CW T.: Auf kHz-Raster einrasten"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(457.0, 150.5, 475.5, 161.5) + '" data-nar="1" title="IF FIL: Filterbreite wechseln"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(457.0, 167.0, 475.5, 178.0) + '" data-tat="filclr" title="FIL CLR: Filter auf 2,4 kHz zurücksetzen"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(457.0, 183.5, 475.5, 194.5) + '" data-fine="1" title="FINE: 10 Hz / 100 Hz / 5 kHz"></button>' +

            /* 8. Rechtes DSP-Feld: MONI..NCH, NR/NB1/NB2, RIT/XIT/CL */
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(482.5, 73.5, 501.5, 84.5) + '" data-ton="1" title="MONI: Bedienton ein/aus"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(505.5, 73.5, 524.5, 84.5) + '" data-cont="1" title="CAR: Contour / Audio-EQ"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(528.5, 73.5, 547.5, 84.5) + '" data-agcbtn="1" title="AGC: Regelung"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(556.0, 73.5, 572.0, 84.5) + '" data-notch="1" title="BC: Auto-Notch"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(575.0, 73.5, 591.0, 84.5) + '" data-notch="1" title="NCH: Notch-Filter"></button>' +

            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(529.0, 90.5, 550.0, 101.5) + '" data-dnr="1" title="NR: Rauschunterdrückung (0–3)"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(529.0, 105.5, 550.0, 116.5) + '" data-nb="1" title="NB1: Noise Blanker"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(529.0, 120.5, 550.0, 131.5) + '" data-asc="1" title="NB2: Auto-Squelch (ASC)"></button>' +

            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(482.5, 141.0, 501.5, 152.0) + '" data-rit="1" title="RIT: Feinabstimmung"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(505.5, 141.0, 524.5, 152.0) + '" data-split="1" title="XIT / SPLIT"></button>' +
            '<button type="button" class="ts-spot ts-spot-key" style="' + tsBox(528.5, 141.0, 547.5, 152.0) + '" data-tat="dspreset" title="CL: DSP & RIT zurücksetzen"></button>' +

            /* 9. Alle 8 echten interaktiven Drehknopfe (Canvas-Zeiger + Mausrad/Ziehen) */
            '<div class="ts-knob" style="' + tsKnobBox(465.0, 47.0, 15.0) + '" data-tsk="key" title="KEY/DELAY: Mausrad für NR-Stufe (0–3)">' +
              '<canvas class="ts-knob-cv" data-knob="key" data-ang="-105"></canvas>' +
            '</div>' +
            '<div class="ts-knob" style="' + tsKnobBox(513.5, 47.0, 15.0) + '" data-tsk="mic" title="MIC/PWR: Mausrad / Klick für ATT (0 / 10 / 20 dB)">' +
              '<canvas class="ts-knob-cv" data-knob="mic" data-ang="-90"></canvas>' +
            '</div>' +
            '<div class="ts-knob" style="' + tsKnobBox(562.0, 47.0, 15.0) + '" data-tsk="shft" title="SHIFT/WIDTH: Mausrad / Klick für ZF-Filterbreite">' +
              '<canvas class="ts-knob-cv" data-knob="shft" data-ang="-35"></canvas>' +
            '</div>' +
            '<div class="ts-knob" style="' + tsKnobBox(501.0, 111.5, 15.0) + '" data-tsk="mult" title="MULTI/CH: Mausrad für Abstimmschritt · Klick öffnet Auswahl">' +
              '<canvas class="ts-knob-cv" data-knob="mult" data-ang="0"></canvas>' +
            '</div>' +
            '<div class="ts-knob" style="' + tsKnobBox(510.5, 174.0, 15.0) + '" data-tsk="rxit" title="RIT/XIT: Feinabstimmung (±10 Hz) · Klick schaltet RIT">' +
              '<canvas class="ts-knob-cv" data-knob="rxit" data-ang="0"></canvas>' +
            '</div>' +
            '<div class="ts-knob" style="' + tsKnobBox(564.5, 113.0, 14.0) + '" data-tsk="sql" title="NOTCH/SQL: Ziehen oder Mausrad für Squelch · Klick = Reset">' +
              '<canvas class="ts-knob-cv" data-knob="sql" data-ang="-135"></canvas>' +
            '</div>' +
            '<div class="ts-knob" style="' + tsKnobBox(564.5, 173.5, 14.0) + '" data-tsk="af" title="AF/RF: Ziehen/Mausrad · Klick wechselt AF (VOL) ⇄ RF-GAIN">' +
              '<canvas class="ts-knob-cv" data-knob="af" data-mode="af" data-ang="45"></canvas>' +
              '<span class="ts-knob-tag" data-feld="afkmode">AF</span>' +
            '</div>' +
            '<div class="ts-knob ts-vfo-knob" style="' + tsKnobBox(403.5, 158.5, 46.8) + '" data-feld="dial" title="Haupt-VFO: Ziehen, Mausrad oder Pfeiltasten">' +
              '<canvas class="ts-knob-cv" data-knob="vfo" data-ang="0"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="fg-eck tl" data-eck="tl" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<div class="fg-eck tr" data-eck="tr" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<div class="fg-eck bl" data-eck="bl" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<div class="fg-eck br" data-eck="br" title="Größe ziehen (Doppelklick = Standard)"></div>' +
        '<button type="button" class="fg-wechsel" data-wechsel="3" title="Zu Funkgerät 3 wechseln">⇄ 3</button>' +
        '<button type="button" class="fg-zu" data-zu title="Funkgerät 2 schließen">×</button>' +
      '</div>';

    /* --- Popover-Steuerung im TS-890S Display --- */
    function tsPopSchliessen() {
      Array.prototype.forEach.call(w.querySelectorAll(".ts-pop.offen"), function (p) { p.classList.remove("offen"); });
    }
    function tsPopOeffnen(name) {
      var p = w.querySelector('[data-tspop="' + name + '"]');
      if (!p) { return; }
      var warOffen = p.classList.contains("offen");
      tsPopSchliessen();
      if (!warOffen) {
        p.classList.add("offen");
        if (name === "level") { tsTelemetrieSync(w); }
        if (name === "wfopt") { tsWfOptSync(); }
      }
    }
    function tsWfOptSync() {
      var curM2 = SCOPE.mode2 || "std";
      Array.prototype.forEach.call(w.querySelectorAll("[data-tswfmode]"), function (b) {
        b.classList.toggle("an", b.getAttribute("data-tswfmode") === curM2);
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-tswfpal]"), function (b) {
        b.classList.toggle("an", b.getAttribute("data-tswfpal") === SCOPE.palette);
      });
      var bPk = w.querySelector('[data-tswftog="peak"]'); if (bPk) { bPk.classList.toggle("an", !!SCOPE.peakHold); }
      var bAu = w.querySelector('[data-tswftog="auto"]'); if (bAu) { bAu.classList.toggle("an", !!SCOPE.autoLevel); }
      var bDir = w.querySelector('[data-feld="wfdirbtn"]');
      if (bDir) {
        bDir.textContent = SCOPE.wfDown ? "FLUSS: ABWÄRTS" : "FLUSS: AUFWÄRTS";
        bDir.classList.toggle("an", !SCOPE.wfDown);
      }
      var bC = w.querySelector('.ts-wf-opts [data-ts-sk="center"]'); if (bC) { bC.classList.toggle("an", !!SCOPE.centered); }
      var bE = w.querySelector('.ts-wf-opts [data-ts-sk="expand"]'); if (bE) { bE.classList.toggle("an", !!SCOPE.expand); }
      var bSp = w.querySelector('[data-feld="wfspanbtn"]');
      if (bSp) { bSp.textContent = "SPAN: " + (SCOPE.spanHz ? scopeSpanText(SCOPE.spanHz) : "FULL"); }
      var bSd = w.querySelector('[data-feld="wfspdbtn"]');
      if (bSd) { bSd.textContent = "TEMPO: " + (SCOPE_SPEEDS[SCOPE.speedIdx] ? SCOPE_SPEEDS[SCOPE.speedIdx].name : "FAST2"); }
    }
    function tsToast(msg) {
      var g2 = Z.geraete[i];
      if (!g2) { return; }
      g2.meldung = msg;
      zeichnen();
      setTimeout(function () { if (g2.meldung === msg) { g2.meldung = ""; zeichnen(); } }, 2000);
    }

    Array.prototype.forEach.call(w.querySelectorAll("[data-tspopopen]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); tsPopOeffnen(b.getAttribute("data-tspopopen")); };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-tspopx]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); tsPopSchliessen(); };
    });
    var bOpenProf2 = w.querySelector('[data-tsopenprof="1"]');
    if (bOpenProf2) {
      bOpenProf2.onclick = function (ev) {
        ev.stopPropagation(); fgKlick("taste"); tsPopSchliessen(); menuZeigen(true, 4);
      };
    }

    /* --- Direkt-Ziffernblock & Tastatur im Display --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-ziffer]"), function (t) {
      t.onclick = function () { fgKlick("taste"); tasteV1(i, t.dataset.ziffer); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="klar"]'), function (b) {
      b.onclick = function () { fgKlick("taste"); EINGABE[i] = ""; zeichnen(); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="enter"]'), function (b) {
      b.onclick = function () {
        if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
        var pad = w.querySelector('[data-tspop="pad"]');
        if (EINGABE[i]) {
          fgKlick("rast"); enterV1(i); tsPopSchliessen();
        } else if (pad && !pad.classList.contains("offen")) {
          fgKlick("taste"); tsPopOeffnen("pad");
        } else {
          tsPopSchliessen();
        }
      };
    });
    var bEsc = w.querySelector('[data-tat="esc"]');
    if (bEsc) {
      bEsc.onclick = function () { fgKlick("taste"); EINGABE[i] = ""; tsPopSchliessen(); zeichnen(); };
    }
    w.addEventListener("keydown", function (ev) {
      var pad = w.querySelector('[data-tspop="pad"]');
      if (!pad || !pad.classList.contains("offen")) { return; }
      if (/^[0-9.]$/.test(ev.key)) { ev.preventDefault(); tasteV1(i, ev.key); }
      else if (ev.key === "Backspace") { ev.preventDefault(); EINGABE[i] = EINGABE[i].slice(0, -1); zeichnen(); }
      else if (ev.key === "Enter") {
        ev.preventDefault();
        if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
        enterV1(i); tsPopSchliessen();
      }
      else if (ev.key === "Escape") { ev.preventDefault(); tsPopSchliessen(); }
    });

    /* Matrix-Bandtasten 1.8..50: im Pad-Modus Ziffern, sonst direktes HAM-Band */
    Array.prototype.forEach.call(w.querySelectorAll("[data-ts-keyband]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
        var pad = w.querySelector('[data-tspop="pad"]');
        if (pad && pad.classList.contains("offen")) {
          fgKlick("taste"); tasteV1(i, b.getAttribute("data-ts-keydig"));
          return;
        }
        fgKlick("rast");
        var bName = b.getAttribute("data-ts-keyband");
        var bd = BAENDER.filter(function (x) { return x.n === bName; })[0];
        if (bd) { bandWaehlen(i, bd); }
      };
    });

    /* Band / Modus / Speicher / Schritt im Popover */
    Array.prototype.forEach.call(w.querySelectorAll("[data-band]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var bd = BAENDER.filter(function (x) { return x.n === b.dataset.band; })[0];
        if (bd) { bandWaehlen(i, bd); }
        tsPopSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-modus]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        Z.aktiv = i;
        Z.geraete.forEach(function (gg) { gg.modus = b.dataset.modus; });
        empfangenModus(b.dataset.modus);
        sichern(); zeichnen(); tsPopSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-tsmode]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        var md = b.getAttribute("data-tsmode");
        var g2 = Z.geraete[i];
        var next = md;
        if (md === "LSB/USB") { next = (g2.modus === "LSB") ? "USB" : "LSB"; }
        else if (md === "FM/AM") { next = (g2.modus === "AM") ? "FM" : "AM"; }
        Z.aktiv = i;
        Z.geraete.forEach(function (gg) { gg.modus = next; });
        empfangenModus(next);
        sichern();
        tsToast("MODUS: " + next);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-mem]"), function (b) {
      b.onclick = function () {
        if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var sp = SPEICHER[parseInt(b.dataset.mem, 10)];
        if (sp) { Z.geraete[i].sp = parseInt(b.dataset.mem, 10); abstimmen(i, sp.hz, sp.m, sp.n); }
        tsPopSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-step]"), function (b) {
      b.onclick = function () {
        fgKlick("rast");
        Z.geraete[i].schritt = parseInt(b.dataset.step, 10);
        sichern(); zeichnen(); tsTelemetrieSync(w); tsPopSchliessen();
      };
    });

    /* --- Scope & Softkeys F1..F5 --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-ts-sk]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var act = b.getAttribute("data-ts-sk");
        if (act === "center") {
          SCOPE.centered = !SCOPE.centered; scopeCfgSichern();
          tsToast(SCOPE.centered ? "Scope: zentriert" : "Scope: Server");
        } else if (act === "smode") {
          var ord = ["std", "3d", "multi"];
          SCOPE.mode2 = ord[(ord.indexOf(SCOPE.mode2 || "std") + 1) % ord.length];
          scopeCfgSichern();
          tsToast("Bandscope: " + (SCOPE.mode2 === "3d" ? "3D (3DSS)" : (SCOPE.mode2 === "multi" ? "MULTI" : "2D NORMAL")));
        } else if (act === "span") {
          var idx = SCOPE_SPANS.indexOf(SCOPE.spanHz);
          SCOPE.spanHz = SCOPE_SPANS[(idx + 1) % SCOPE_SPANS.length];
          if (SCOPE.spanHz > 0) { SCOPE.centered = true; }
          scopeCfgSichern();
          tsToast("Span: " + (SCOPE.spanHz ? scopeSpanText(SCOPE.spanHz) : "FULL"));
        } else if (act === "speed") {
          SCOPE.speedIdx = (SCOPE.speedIdx + 1) % SCOPE_SPEEDS.length; scopeCfgSichern();
          tsToast("Tempo: " + SCOPE_SPEEDS[SCOPE.speedIdx].name);
        } else if (act === "expand") {
          SCOPE.expand = !SCOPE.expand;
          var sb = w.querySelector(".ts-scr-scope"); if (sb) { sb.classList.toggle("expand", SCOPE.expand); }
          scopeCfgSichern();
          tsToast(SCOPE.expand ? "Scope: groß" : "Scope: normal");
        }
        tsWfOptSync();
        scopeZeichnen(i, w, true);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-tswfmode]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        SCOPE.mode2 = b.getAttribute("data-tswfmode");
        scopeCfgSichern();
        tsWfOptSync();
        scopeZeichnen(i, w, true);
        tsToast("Bandscope: " + (SCOPE.mode2 === "3d" ? "3DSS" : (SCOPE.mode2 === "multi" ? "MULTI" : "2D NORMAL")));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-tswfpal]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        SCOPE.palette = b.getAttribute("data-tswfpal");
        scopeCfgSichern(); tsWfOptSync();
        scopeZeichnen(i, w, true);
        if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
        tsToast("Palette: " + b.textContent);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-tswftog]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        var k = b.getAttribute("data-tswftog");
        if (k === "peak") { SCOPE.peakHold = !SCOPE.peakHold; tsToast("Peak-Hold " + (SCOPE.peakHold ? "EIN" : "AUS")); }
        if (k === "auto") { SCOPE.autoLevel = !SCOPE.autoLevel; tsToast("Auto-Pegel " + (SCOPE.autoLevel ? "EIN" : "AUS")); }
        if (k === "wfdir") {
          SCOPE.wfDown = !SCOPE.wfDown;
          tsToast(SCOPE.wfDown ? "Wasserfall: ABWÄRTS" : "Wasserfall: AUFWÄRTS");
        }
        scopeCfgSichern(); tsWfOptSync();
        scopeZeichnen(i, w, true);
        if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
      };
    });

    document.addEventListener("click", function (ev) {
      if (ev && ev.isTrusted === false) { return; }
      if (!w.querySelector(".ts-pop.offen")) { return; }
      if (ev.target && ev.target.closest && ev.target.closest(".ts-pop, [data-tspopopen], [data-tpill], [data-tsk]")) { return; }
      tsPopSchliessen();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && w.querySelector(".ts-pop.offen")) { tsPopSchliessen(); }
    });

    var sc2 = w.querySelector('[data-feld="w2scope"]');
    if (sc2) {
      sc2.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      sc2.addEventListener("click", function (ev) {
        if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
        var r = sc2.getBoundingClientRect();
        if (!r || !(r.width > 10)) { return; }
        var curM2 = SCOPE.mode2 || "std";
        var relX = ev.clientX - r.left;
        var spanW = (curM2 === "multi") ? Math.max(10, r.width * 0.54) : Math.max(10, r.width - 6);
        var u = Math.max(0, Math.min(1, (curM2 === "multi" && relX > spanW) ? ((relX - spanW) / Math.max(10, r.width - spanW)) : (relX / spanW)));
        var win = scopeFensterBerechnen(Z.geraete[i]);
        var hz = Math.round(win.f0 + u * win.bw);
        abstimmen(i, hz, null, "Scope: " + hzKurz(hz) + " MHz");
      });
    }

    /* --- Tasten: COLOR, DW, SCAN, MENU, PWR, DSP, FILTER, REC --- */
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="color2"]'), function (cb) {
      cb.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var cur = lichtIdLesen(1), idx = 0;
        for (var k = 0; k < LICHT_FARBEN.length; k++) { if (LICHT_FARBEN[k].id === cur) { idx = k; break; } }
        var next = LICHT_FARBEN[(idx + 1) % LICHT_FARBEN.length];
        lichtAnwenden(next.id, 1);
        tsToast("COLOR: " + next.name);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="dw"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("rast"); dwToggle(i); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="scan"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("rast"); scanToggle(i); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="menu"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); menuZeigen(true); };
    });
    var bPwr2 = w.querySelector('[data-tat="pwr"]');
    if (bPwr2) {
      bPwr2.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("rast");
        if (ev.shiftKey) {
          var scr = w.querySelector(".ts-screen-slot");
          if (scr) { scr.classList.toggle("dim"); }
          ledsSetzen(i, Z.geraete[i], w);
          tsToast((scr && scr.classList.contains("dim")) ? "DISPLAY GEDIMMT" : "DISPLAY HELL");
          return;
        }
        Z.geraete[i].lockAn = !Z.geraete[i].lockAn;
        zeichnen();
        tsToast(Z.geraete[i].lockAn ? "VFO GESPERRT (LOCK)" : "VFO FREI");
      };
    }
    Array.prototype.forEach.call(w.querySelectorAll("[data-lock2]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var g2 = Z.geraete[i];
        g2.lockAn = !g2.lockAn;
        zeichnen();
        tsToast(g2.lockAn ? "VFO GESPERRT (LOCK)" : "VFO FREI");
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-nb]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        MENU_STAND.nb = !MENU_STAND.nb; menuStandSichern();
        afSet("NB", MENU_STAND.nb);
        zeichnen();
        tsToast("NB1 " + (MENU_STAND.nb ? "EIN" : "AUS"));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-dnr]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        MENU_STAND.nr = (MENU_STAND.nr + 1) % 4; menuStandSichern();
        nrSetzen(MENU_STAND.nr); afSet("NR", MENU_STAND.nr > 0);
        zeichnen(); tsTelemetrieSync(w);
        tsToast(MENU_STAND.nr ? ("NR STUFE " + MENU_STAND.nr) : "NR AUS");
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-nar]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var bwList = [2400, 1800, 500, 3000];
        var idx = bwList.indexOf(MENU_STAND.filt || 2400);
        MENU_STAND.filt = bwList[(idx + 1) % bwList.length];
        menuStandSichern(); zeichnen(); tsTelemetrieSync(w);
        tsToast("IF FIL: " + (MENU_STAND.filt >= 1000 ? (MENU_STAND.filt / 1000).toFixed(1) + " kHz" : (MENU_STAND.filt + " Hz")));
      };
    });
    var bFilClr = w.querySelector('[data-tat="filclr"]');
    if (bFilClr) {
      bFilClr.onclick = function () {
        fgKlick("rast");
        MENU_STAND.filt = 2400; menuStandSichern(); zeichnen(); tsTelemetrieSync(w);
        tsToast("IF FIL: 2.4 kHz (RESET)");
      };
    }
    Array.prototype.forEach.call(w.querySelectorAll("[data-fine]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var gg = Z.geraete[i];
        gg.schritt = (gg.schritt === 10) ? 100 : ((gg.schritt === 100) ? 1000 : ((gg.schritt === 1000) ? 5000 : 10));
        sichern(); zeichnen(); tsTelemetrieSync(w);
        tsToast("SCHRITT: " + schrittText(gg.schritt));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-ton="1"]'), function (b) {
      b.onclick = function () {
        MENU_STAND.ton = !MENU_STAND.ton; menuStandSichern();
        if (MENU_STAND.ton) { fgKlick("rast"); }
        zeichnen(); tsTelemetrieSync(w);
        tsToast(MENU_STAND.ton ? "TON / MONI EIN" : "TON AUS");
      };
    });
    var bMute = w.querySelector('[data-tat="mute"]');
    if (bMute) {
      bMute.onclick = function () {
        fgKlick("rast");
        var cur = volProzent();
        var nv = (cur > 0) ? (bMute.dataset.prevVol = String(cur), 0) : (parseInt(bMute.dataset.prevVol || "100", 10) || 100);
        volSetzen(nv); ledsSetzen(i, Z.geraete[i], w); tsTelemetrieSync(w);
        tsToast(nv === 0 ? "AUDIO STUMM" : ("VOL: " + nv + "%"));
      };
    }
    var bStopAll = w.querySelector('[data-tat="stopall"]');
    if (bStopAll) {
      bStopAll.onclick = function () {
        fgKlick("rast");
        if (DW_STATE.aktiv) { dwStoppen(i); }
        if (SCAN_STATE.aktiv) { scanStoppen(i); }
        tsToast("DW / SCAN GESTOPPT");
      };
    }
    var bReset2 = w.querySelector('[data-tat="dspreset"]');
    if (bReset2) {
      bReset2.onclick = function () {
        fgKlick("rast");
        MENU_STAND.nb = false; MENU_STAND.nr = 0; MENU_STAND.notch = false; MENU_STAND.eq = false;
        afSet("NB", false); afSet("NR", false); afSet("Notch", false); afSet("EQ", false);
        Z.geraete.forEach(function (o) { o.ritAn = false; o.ritOff = 0; });
        var scr = w.querySelector(".ts-screen-slot");
        if (scr) { scr.classList.remove("dim"); }
        menuStandSichern(); zeichnen(); tsTelemetrieSync(w);
        tsToast("DSP & RIT zurückgesetzt");
      };
    }

    /* --- Top-Bezel Telemetrie Pills & Inline Popover Sliders --- */
    var pVol = w.querySelector('[data-tpill="vol"]');
    if (pVol) {
      pVol.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var nv = volSetzen(volProzent() + (ev.deltaY < 0 ? 5 : -5));
        tsTelemetrieSync(w); tsToast("VOL: " + nv + "%");
      }, { passive: false });
      pVol.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); tsPopOeffnen("level"); };
      pVol.ondblclick = function (ev) {
        ev.stopPropagation();
        var cur = volProzent();
        var nv = (cur > 0) ? (pVol.dataset.prevVol = String(cur), 0) : (parseInt(pVol.dataset.prevVol || "100", 10) || 100);
        volSetzen(nv); tsTelemetrieSync(w);
        tsToast(nv === 0 ? "AUDIO STUMM" : ("VOL: " + nv + "%"));
      };
    }
    var pSq = w.querySelector('[data-tpill="sq"]');
    if (pSq) {
      pSq.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var sq = (typeof MENU_STAND.squelch === "number" ? MENU_STAND.squelch : -150) + (ev.deltaY < 0 ? 5 : -5);
        sq = Math.max(-150, Math.min(0, Math.round(sq)));
        MENU_STAND.squelch = sq; menuStandSichern(); squelchSetzen(sq); reglerSyncAlle();
        tsToast("SQUELCH: " + (sq <= -149 ? "AUS" : (sq + " dB")));
      }, { passive: false });
      pSq.onclick = function (ev) {
        ev.stopPropagation(); fgKlick("taste");
        var nv = (MENU_STAND.squelch > -149) ? -150 : -75;
        MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
        tsToast(nv <= -149 ? "SQUELCH: AUS" : "SQUELCH: -75 dB");
      };
    }
    var pRf = w.querySelector('[data-tpill="rf"]');
    if (pRf) {
      pRf.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var cur = (typeof MENU_STAND.rf === "number") ? MENU_STAND.rf : 20;
        var nv = Math.max(RF_MIN, Math.min(RF_MAX, cur + (ev.deltaY < 0 ? 2 : -2)));
        rfAnwenden(nv);
        tsToast("RF-GAIN: " + nv + " dB");
      }, { passive: false });
      pRf.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); tsPopOeffnen("level"); };
    }

    var slVol = w.querySelector('[data-lvl="vol"]');
    if (slVol) {
      slVol.addEventListener("input", function () { volSetzen(parseInt(slVol.value, 10)); tsTelemetrieSync(w); });
    }
    var slSq = w.querySelector('[data-lvl="sq"]');
    if (slSq) {
      slSq.addEventListener("input", function () {
        var nv = parseInt(slSq.value, 10);
        MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
      });
    }
    var slRf = w.querySelector('[data-lvl="rf"]');
    if (slRf) {
      slRf.addEventListener("input", function () { rfAnwenden(parseInt(slRf.value, 10)); });
    }
    Array.prototype.forEach.call(w.querySelectorAll('[data-asc="1"]'), function (bAsc) {
      bAsc.onclick = function () {
        fgKlick("rast");
        var autoSq = (MENU_STAND.squelch > -149) ? -150 : -68;
        MENU_STAND.squelch = autoSq; menuStandSichern(); squelchSetzen(autoSq); reglerSyncAlle();
        tsToast(autoSq <= -149 ? "NB2 / ASC AUS" : "NB2 / ASC (-68 dB)");
      };
    });

    /* --- 8 Rotary-Knob-Controller auf dem TS-890S Chassis --- */
    function bindTsEncoder(name, onStep, onClick) {
      var wrap = w.querySelector('[data-tsk="' + name + '"]');
      if (!wrap) { return; }
      var st = { drag: false, ly: 0, acc: 0, moved: false };
      function onMove(ev) {
        if (!st.drag) { return; }
        var dy = st.ly - ev.clientY;
        st.ly = ev.clientY;
        st.acc += dy;
        while (Math.abs(st.acc) >= 5) {
          var dir = st.acc > 0 ? 1 : -1;
          st.acc -= dir * 5;
          st.moved = true;
          fgKlick("dial");
          onStep(dir);
        }
        ev.stopPropagation();
        if (ev.cancelable && ev.preventDefault) { ev.preventDefault(); }
      }
      function onDone(ev, allowClick) {
        if (!st.drag) { return; }
        st.drag = false;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("blur", onCancel, true);
        if (allowClick && !st.moved && typeof onClick === "function") { fgKlick("rast"); onClick(ev); }
      }
      function onUp(ev) { onDone(ev, true); }
      function onCancel(ev) { onDone(ev, false); }
      wrap.addEventListener("pointerdown", function (ev) {
        if (ev && ev.button && ev.button !== 0) { return; }
        st.drag = true; st.ly = ev.clientY; st.acc = 0; st.moved = false;
        window.addEventListener("pointermove", onMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onCancel, true);
        window.addEventListener("blur", onCancel, true);
        ev.preventDefault(); ev.stopPropagation();
      });
      wrap.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        fgKlick("dial");
        onStep(ev.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }

    bindTsEncoder("af", function (dir) {
      var cv = w.querySelector('canvas[data-knob="af"]');
      if (cv && cv.dataset.mode === "rf") {
        var curR = (typeof MENU_STAND.rf === "number") ? MENU_STAND.rf : 20;
        var nvR = Math.max(RF_MIN, Math.min(RF_MAX, curR + dir * 2));
        rfAnwenden(nvR); tsToast("RF GAIN: " + nvR + " dB");
      } else {
        var nv = volSetzen(volProzent() + dir * 5);
        tsTelemetrieSync(w); tsToast("AF GAIN (VOL): " + nv + "%");
      }
    }, function () {
      var cv = w.querySelector('canvas[data-knob="af"]');
      var tag = w.querySelector('[data-feld="afkmode"]');
      if (cv) {
        var nextRf = (cv.dataset.mode !== "rf");
        cv.dataset.mode = nextRf ? "rf" : "af";
        if (tag) { tag.textContent = nextRf ? "RF" : "AF"; }
        tsTelemetrieSync(w);
        tsToast(nextRf ? "Regler auf RF-GAIN" : "Regler auf AF (VOL)");
      }
    });

    bindTsEncoder("sql", function (dir) {
      var sq = (typeof MENU_STAND.squelch === "number" ? MENU_STAND.squelch : -150) + dir * 5;
      sq = Math.max(-150, Math.min(0, Math.round(sq)));
      MENU_STAND.squelch = sq; menuStandSichern(); squelchSetzen(sq); reglerSyncAlle();
      tsToast("SQUELCH: " + (sq <= -149 ? "AUS" : (sq + " dB")));
    }, function () {
      var nv = (MENU_STAND.squelch > -149) ? -150 : -75;
      MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
      tsToast(nv <= -149 ? "SQUELCH: AUS" : "SQUELCH: -75 dB");
    });

    bindTsEncoder("mult", function (dir) {
      var gg = Z.geraete[i];
      var idx = SCHRITTE.indexOf(gg.schritt); if (idx < 0) { idx = 1; }
      gg.schritt = SCHRITTE[Math.max(0, Math.min(SCHRITTE.length - 1, idx + dir))];
      sichern(); zeichnen(); tsTelemetrieSync(w);
      tsToast("STEP: " + schrittText(gg.schritt));
    }, function () {
      tsPopOeffnen("step");
    });

    bindTsEncoder("rxit", function (dir) {
      var cv = w.querySelector('canvas[data-knob="rxit"]');
      if (cv) { cv.dataset.ang = String((parseFloat(cv.dataset.ang || "0") + dir * 18) % 360); }
      var gg = Z.geraete[i];
      if (!gg.ritAn) { gg.ritAn = true; gg.ritBasis = gg.hz; gg.ritOff = 0; }
      gg.ritOff = (gg.ritOff || 0) + dir * 10;
      abstimmen(i, gg.hz + dir * 10, null, "RIT " + (gg.ritOff >= 0 ? "+" : "") + gg.ritOff + " Hz");
      tsKnobsRedraw(w);
    }, function () {
      var bRit = w.querySelector("[data-rit]");
      if (bRit) { bRit.click(); }
    });

    bindTsEncoder("key", function (dir) {
      MENU_STAND.nr = ((MENU_STAND.nr || 0) + (dir > 0 ? 1 : 3)) % 4;
      menuStandSichern(); nrSetzen(MENU_STAND.nr); afSet("NR", MENU_STAND.nr > 0);
      zeichnen(); tsTelemetrieSync(w);
      tsToast(MENU_STAND.nr ? ("NR STUFE " + MENU_STAND.nr) : "NR AUS");
    });

    bindTsEncoder("mic", function (dir) {
      var attL = [0, 10, 20];
      var idx = (attL.indexOf(MENU_STAND.att || 0) + (dir > 0 ? 1 : 2)) % 3;
      MENU_STAND.att = attL[idx]; menuStandSichern(); zeichnen(); tsTelemetrieSync(w);
      tsToast(MENU_STAND.att ? ("ATT -" + MENU_STAND.att + " dB") : "ATT AUS");
    }, function () {
      var attB = w.querySelector('[data-attbtn="1"]'); if (attB) { attB.click(); } tsTelemetrieSync(w);
    });

    bindTsEncoder("shft", function (dir) {
      var bwL = [3000, 2400, 1800, 500];
      var idx = (bwL.indexOf(MENU_STAND.filt || 2400) + (dir > 0 ? 1 : 3)) % 4;
      MENU_STAND.filt = bwL[idx]; menuStandSichern(); zeichnen(); tsTelemetrieSync(w);
      tsToast("FILTER: " + (MENU_STAND.filt >= 1000 ? (MENU_STAND.filt / 1000).toFixed(1) + " kHz" : (MENU_STAND.filt + " Hz")));
    }, function () {
      var narB = w.querySelector('[data-nar="1"]'); if (narB) { narB.click(); } tsTelemetrieSync(w);
    });

    radBinden(w.querySelector('[data-feld="dial"]'), function (richtung) {
      if (Z.geraete[i].lockAn) { tsToast("VFO GESPERRT (LOCK)"); return; }
      if (SCAN_STATE.aktiv) { scanStoppen(i); }
      var cv = w.querySelector('canvas[data-knob="vfo"]');
      if (cv) {
        cv.dataset.ang = String((parseFloat(cv.dataset.ang || "0") + richtung * 15) % 360);
        tsKnobsRedraw(w);
      }
      drehen(i, richtung);
    });

    g._smeter = meterBauenV2(w.querySelector('[data-feld="smeter"]'), 128, 48);
    bindenErweitert(w, i);
    griffBinden(w, g);
    resizeBinden(w, g);
    schliessenBinden(w, g);
    document.body.appendChild(w);
    resizeAnwenden(w, g);
    lichtAnwenden(lichtIdLesen(1), 1);
    tsTelemetrieSync(w);
    setTimeout(function () { resizeAnwenden(w, g); scopeZeichnen(i, w, true); tsTelemetrieSync(w); }, 90);
    return w;
  }


  /* ================= Vorlage 3 (FUNKGERÄT 3: Touch-Konsole markenfrei) == */
  var IC_IMG_URL = "static/plugins/receiver/funkgeraet3_ic7300_v824.png?v=824";
  var IC_W0 = 620, IC_H0 = 282;

  function icBox(x0, y0, x1, y1) {
    return "left:" + (x0 * 100 / IC_W0).toFixed(3) + "%;top:" + (y0 * 100 / IC_H0).toFixed(3) +
           "%;width:" + ((x1 - x0) * 100 / IC_W0).toFixed(3) + "%;height:" + ((y1 - y0) * 100 / IC_H0).toFixed(3) + "%;";
  }
  function icKnobBox(cx, cy, r) {
    return icBox(cx - r, cy - r, cx + r, cy + r);
  }

  function icKnobsRedraw(w, farbe) {
    if (!w) { return; }
    var f = farbe || lichtObj(lichtIdLesen(2));
    var hex = f.aus ? "#64748b" : f.hex;
    var rgb = f.aus ? "100,116,139" : f.rgb;

    Array.prototype.forEach.call(w.querySelectorAll("canvas.ic-knob-cv"), function (cv) {
      var ang = parseFloat(cv.dataset.ang || "0") || 0;
      var kType = cv.dataset.knob || "";
      var istVfo = (kType === "vfo");
      var istRing = (kType === "rfsql");
      var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      var rect = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
      var defW = istVfo ? 128 : (istRing ? 52 : 34);
      var cssW = Math.max(cv.clientWidth || defW, (rect && rect.width > 12) ? rect.width : 0);
      var px = Math.max(20, Math.round(cssW * dpr));
      if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
      var ctx = cv.getContext("2d");
      if (!ctx) { return; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      var r = px / 2;
      var rad = (ang - 90) * Math.PI / 180;

      if (istVfo) {
        if (!f.aus) {
          ctx.beginPath();
          ctx.arc(r, r, r - 1.5 * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(" + rgb + ",0.32)";
          ctx.lineWidth = Math.max(1.8, 2.0 * dpr);
          ctx.stroke();
        }
        var dx = r + Math.cos(rad) * r * 0.48;
        var dy = r + Math.sin(rad) * r * 0.48;
        ctx.beginPath();
        ctx.arc(dx, dy, Math.max(3.0, 3.6 * dpr), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,18,0.62)";
        ctx.fill();
        ctx.strokeStyle = f.aus ? "rgba(226,232,240,0.45)" : "rgba(" + rgb + ",0.90)";
        ctx.lineWidth = Math.max(1.2, 1.3 * dpr);
        ctx.stroke();
        return;
      }

      if (istRing) {
        var rx0 = r + Math.cos(rad) * r * 0.72;
        var ry0 = r + Math.sin(rad) * r * 0.72;
        var rx1 = r + Math.cos(rad) * r * 0.94;
        var ry1 = r + Math.sin(rad) * r * 0.94;
        ctx.beginPath();
        ctx.moveTo(rx0, ry0);
        ctx.lineTo(rx1, ry1);
        ctx.strokeStyle = f.aus ? "rgba(226,232,240,0.85)" : hex;
        ctx.lineWidth = Math.max(2.0, 2.2 * dpr);
        ctx.lineCap = "round";
        ctx.stroke();
        return;
      }

      var x0 = r + Math.cos(rad) * r * 0.28;
      var y0 = r + Math.sin(rad) * r * 0.28;
      var x1 = r + Math.cos(rad) * r * 0.68;
      var y1 = r + Math.sin(rad) * r * 0.68;
      if (!f.aus) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = "rgba(" + rgb + ",0.55)";
        ctx.lineWidth = Math.max(2.5, 2.7 * dpr);
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = f.aus ? "rgba(226,232,240,0.9)" : "#f8fafc";
      ctx.lineWidth = Math.max(1.2, 1.3 * dpr);
      ctx.lineCap = "round";
      ctx.stroke();
    });
  }

  function icTelemetrieSync(w) {
    if (!w) { return; }
    var v = volProzent();
    var sqV = (typeof MENU_STAND.squelch === "number") ? MENU_STAND.squelch : -150;
    var rfV = (MENU_STAND.rf === null || MENU_STAND.rf === undefined) ? 20 : MENU_STAND.rf;
    var sqTxt = (sqV <= -149) ? "AUS" : (sqV + "dB");
    var rfTxt = (_rfState.modus === "auto") ? "AGC" : (rfV + "dB");

    var bVol = w.querySelector('[data-feld="tvol"]');
    var bSq  = w.querySelector('[data-feld="tsq"]');
    var bRf  = w.querySelector('[data-feld="trf"]');
    if (bVol) { bVol.textContent = "VOL " + v + "%"; bVol.classList.toggle("an", v === 0); }
    if (bSq)  { bSq.textContent  = "SQ " + sqTxt; bSq.classList.toggle("an", sqV > -149); }
    if (bRf)  { bRf.textContent  = "RF " + rfTxt; bRf.classList.toggle("an", _rfState.modus !== "auto"); }

    var afCv = w.querySelector('canvas[data-knob="af"]');
    if (afCv) { afCv.dataset.ang = String(-135 + (v / 150) * 270); }
    var rfCv = w.querySelector('canvas[data-knob="rfsql"]');
    if (rfCv) {
      var rfNorm = (rfV - RF_MIN) / Math.max(1, RF_MAX - RF_MIN);
      rfCv.dataset.ang = String(-135 + Math.max(0, Math.min(1, rfNorm)) * 270);
    }
    var pbtCv = w.querySelector('canvas[data-knob="pbt"]');
    if (pbtCv) {
      var bwL = [3000, 2400, 1800, 500];
      var bIdx = Math.max(0, bwL.indexOf(MENU_STAND.filt || 2400));
      pbtCv.dataset.ang = String(-105 + (bIdx / 3) * 210);
    }
    var mCv = w.querySelector('canvas[data-knob="multi"]');
    if (mCv) {
      var g2 = Z.geraete[2] || {};
      var sIdx = Math.max(0, SCHRITTE.indexOf(g2.schritt || 1000));
      mCv.dataset.ang = String(-115 + (sIdx / Math.max(1, SCHRITTE.length - 1)) * 230);
    }
    icKnobsRedraw(w, lichtObj(lichtIdLesen(2)));

    var pop = w.querySelector('[data-icpop="level"]');
    if (pop && pop.classList.contains("offen")) {
      var rVol = pop.querySelector('[data-lvl="vol"]'), lVol = pop.querySelector('[data-lvlval="vol"]');
      if (rVol) { rVol.value = String(v); } if (lVol) { lVol.textContent = v + " %"; }
      var rSq = pop.querySelector('[data-lvl="sq"]'), lSq = pop.querySelector('[data-lvlval="sq"]');
      if (rSq) { rSq.value = String(sqV); } if (lSq) { lSq.textContent = (sqV <= -149) ? "AUS" : (sqV + " dB"); }
      var rRf = pop.querySelector('[data-lvl="rf"]'), lRf = pop.querySelector('[data-lvlval="rf"]');
      if (rRf) { rRf.value = String(rfV); } if (lRf) { lRf.textContent = rfTxt; }
      var bTon = pop.querySelector('[data-ton="1"]');
      if (bTon) { bTon.classList.toggle("an", !!MENU_STAND.ton); }
    }
  }

  function bauenV3(i) {
    var g = Z.geraete[i];
    var w = document.createElement("div");
    w.className = "fgw fg-w3";
    w.id = "fg-geraet-" + i;

    scopeCfgLaden();
    if (!SCOPE.mode3) { SCOPE.mode3 = "std"; }
    fftHookInstallieren();

    var pbSvg3 =
      '<svg class="ic-pb-svg" viewBox="0 0 120 14" preserveAspectRatio="none">' +
        '<line x1="2" y1="12" x2="118" y2="12" stroke="#94a3b8" stroke-width="0.9"/>' +
        '<path data-pb="1" d="M 32 12 L 37 2 L 88 2 L 93 12" fill="rgba(56,189,248,.18)" stroke="#f1f5f9" stroke-width="1.1"/>' +
        '<rect data-pbbar="1" x="52" y="2.5" width="18" height="9.5" fill="rgba(186,230,253,.32)"/>' +
      '</svg>';

    var ledSvg =
      '<svg class="ic-photo-svg" viewBox="0 0 620 282" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect data-ic-pwrled="1" x="23.0" y="46.8" width="28.0" height="2.2" rx="1.0" fill="#22c55e"/>' +
        '<rect data-ic-txled="1" x="442.5" y="172.5" width="13.5" height="3.0" rx="1.1" fill="#16a34a"/>' +
      '</svg>';

    var padHtml = "";
    ["1","2","3","4","5","6","7","8","9",".","0","C"].forEach(function (k) {
      if (k === "C") {
        padHtml += '<button type="button" class="ic-pad-clr" data-tat="klar">CLR</button>';
      } else {
        padHtml += '<button type="button" data-ziffer="' + k + '">' + k + '</button>';
      }
    });

    w.innerHTML =
      '<div class="ic-shell">' +
        '<div class="ic-stage">' +
          '<div class="ic-chassis" data-griff title="Funkgerät 3 ziehen (oder Ecken skalieren)">' +
            '<img class="ic-photo" src="' + IC_IMG_URL + '" alt="" draggable="false">' +
            ledSvg +

            /* --- Blanke obere Bezel-Zeile: Telemetrie, Lichtfarbe, DW, SCAN, BAND, MENU --- */
            '<div class="ic-top-bar" style="' + icBox(166.0, 38.0, 420.5, 53.5) + '">' +
              '<button type="button" class="ic-tpill" data-feld="tvol" data-tpill="vol" title="Lautstärke (Rad/Klick: Level-Menü, Doppelklick: Stumm)">VOL 100%</button>' +
              '<button type="button" class="ic-tpill" data-feld="tsq" data-tpill="sq" title="Squelch (Rad/Klick)">SQ AUS</button>' +
              '<button type="button" class="ic-tpill" data-feld="trf" data-tpill="rf" title="RF-Gain (Rad/Klick)">RF 20dB</button>' +
              '<button type="button" class="ic-tbtn" data-tat="color3" title="Beleuchtungsfarbe wechseln"><i data-feld="lichtpunkt"></i><em data-feld="lichtname">WEISS</em></button>' +
              '<button type="button" class="ic-tbtn" data-tat="dw" title="Dual Watch (VFO-A ↔ VFO-B)">DW</button>' +
              '<button type="button" class="ic-tbtn" data-tat="scan" title="Suchlauf starten / stoppen">SCN</button>' +
              '<button type="button" class="ic-tbtn" data-icpopopen="band" title="Alle HAM-Bänder &amp; Profile">BND</button>' +
              '<button type="button" class="ic-tbtn ic-tmenu" data-tat="menu" title="Gerätemenü öffnen">☰</button>' +
            '</div>' +

            /* --- Touch-TFT im echten Displayrahmen --- */
            '<div class="ic-screen-slot" style="' + icBox(169.8, 61.0, 417.2, 203.0) + '">' +
              '<div class="ic-scr-hd">' +
                '<button type="button" class="ic-mode-badge" data-icpopopen="mode" data-feld="modus" title="Betriebsart wählen">USB</button>' +
                '<button type="button" class="ic-hd-tag" data-nar="1" title="IF Filter wechseln">FIL <em data-feld="rfilval">2.4k</em></button>' +
                '<button type="button" class="ic-hd-tag" data-ipobtn="1" title="Preamp / IPO"><em data-feld="ipoval">AMP2</em></button>' +
                '<button type="button" class="ic-hd-tag" data-attbtn="1" title="Attenuator"><em data-feld="attval">OFF</em></button>' +
                '<button type="button" class="ic-hd-tag" data-agcbtn="1" title="AGC"><em data-feld="agcval">AUTO</em></button>' +
                '<div class="ic-ind-tags"><i data-ind="dw">DW</i><i data-ind="scn">SCN</i><i data-ind="lck">LCK</i></div>' +
                '<button type="button" class="ic-lvl-btn" data-icpopopen="level" title="Audio · Squelch · RF · DSP">LVL</button>' +
              '</div>' +

              '<div class="ic-scr-top">' +
                '<div class="ic-vfo-main">' +
                  '<div class="ic-vfoa-row">' +
                    '<button type="button" class="ic-freq" data-icpopopen="pad" data-feld="freq" title="Klick: Direkteingabe">29.200.000<small>Hz</small></button>' +
                    '<div class="ic-vfo-side">' +
                      '<button type="button" class="ic-vfo-tag" data-ab="1" data-feld="vfotag" title="VFO-A ↔ VFO-B tauschen">VFO A</button>' +
                      '<button type="button" class="ic-subb" data-ab="1" data-feld="freqb2">29.200.000<small>Hz</small></button>' +
                    '</div>' +
                  '</div>' +
                  '<div class="ic-meter-wrap" data-feld="smeter" title="Echtzeit-S-Meter"></div>' +
                '</div>' +
                '<div class="ic-pb-col">' +
                  pbSvg3 +
                  '<div class="ic-pb-tags">' +
                    '<button type="button" class="ic-step-tag" data-icpopopen="step" data-feld="schritt" title="Abstimmschritt">1 kHz</button>' +
                    '<button type="button" class="ic-scope-info" data-icpopopen="wfopt" data-feld="scopeinfo" title="Wasserfall-Optionen"><b>2D</b> · FAST2 ▾</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="ic-scr-scope' + (SCOPE.expand ? " expand" : "") + '">' +
                '<canvas class="ic-scope-cv" data-feld="w3scope" title="Klick im Spektrum stimmt sofort ab"></canvas>' +
                '<div class="ic-scope-axis">' +
                  '<span data-feld="sf0">-200k</span><span data-feld="sf1">-100k</span>' +
                  '<span class="mid" data-feld="scopefreq">29.200.000</span>' +
                  '<span data-feld="sf3">+100k</span><span data-feld="sf4">+200k</span>' +
                '</div>' +
              '</div>' +

              '<div class="ic-scr-meta">' +
                '<span data-feld="meta">USB · FIL 2,4 kHz · 1 kHz</span>' +
                '<span class="ic-status-msg" data-feld="status">BEREIT</span>' +
              '</div>' +

              '<div class="ic-softkeys">' +
                '<button type="button" data-ic-sk="center" title="CENTER / FIX umschalten">CENT/FIX</button>' +
                '<button type="button" data-ic-sk="span" title="Spanne wechseln">SPAN</button>' +
                '<button type="button" data-ic-sk="smode" title="2D / 3DSS / MULTI umschalten">2D</button>' +
                '<button type="button" data-ic-sk="speed" title="Wasserfall-Tempo">SPEED</button>' +
                '<button type="button" data-ic-sk="expand" title="Scope vergrößern">EXPD</button>' +
                '<button type="button" data-icpopopen="band" title="Bänder &amp; Profile">BAND</button>' +
              '</div>' +

              /* --- 7 Inline-Touch-Overlays im Display --- */
              '<div class="ic-pop" data-icpop="level">' +
                '<div class="ic-pop-hd"><span>AUDIO · SQ · RF-GAIN · DSP</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-lvl-grid">' +
                  '<label class="ic-lvl-row"><b>VOL</b><input type="range" data-lvl="vol" min="0" max="150" step="1"><em data-lvlval="vol">100 %</em></label>' +
                  '<label class="ic-lvl-row"><b>SQ</b><input type="range" data-lvl="sq" min="-150" max="0" step="1"><em data-lvlval="sq">AUS</em></label>' +
                  '<label class="ic-lvl-row"><b>RF</b><input type="range" data-lvl="rf" min="' + RF_MIN + '" max="' + RF_MAX + '" step="1"><em data-lvlval="rf">20 dB</em></label>' +
                  '<div class="ic-lvl-btns">' +
                    '<button type="button" data-asc="1" title="Auto-Squelch">ASC</button>' +
                    '<button type="button" data-nb="1" title="Noise Blanker">NB</button>' +
                    '<button type="button" data-dnr="1" title="Noise Reduction">NR</button>' +
                    '<button type="button" data-notch="1" title="Auto-Notch">NCH</button>' +
                    '<button type="button" data-cont="1" title="Audio-EQ">EQ</button>' +
                    '<button type="button" data-ton="1" title="Bedienton">TON</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="ic-pop" data-icpop="wfopt">' +
                '<div class="ic-pop-hd"><span>SPECTRUM SCOPE &amp; WASSERFALL</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-wf-opts">' +
                  '<div class="ic-wf-grp"><b>ANSICHT (GERÄT 3)</b><div>' +
                    '<button type="button" data-icwfmode="std">2D SCOPE</button>' +
                    '<button type="button" data-icwfmode="3d">3D (3DSS)</button>' +
                    '<button type="button" data-icwfmode="multi">MULTI</button>' +
                  '</div></div>' +
                  '<div class="ic-wf-grp"><b>FARBPALETTE</b><div>' +
                    '<button type="button" data-icwfpal="ft710">BLAU-ROT</button>' +
                    '<button type="button" data-icwfpal="owrx">OWRX</button>' +
                    '<button type="button" data-icwfpal="feuer">FEUER</button>' +
                    '<button type="button" data-icwfpal="eis">EIS</button>' +
                    '<button type="button" data-icwfpal="gruen">GRÜN</button>' +
                  '</div></div>' +
                  '<div class="ic-wf-grp"><b>FLUSS &amp; EXTRAS</b><div>' +
                    '<button type="button" data-icwftog="wfdir" data-feld="wfdirbtn">FLUSS: ABWÄRTS</button>' +
                    '<button type="button" data-icwftog="peak">PEAK-HOLD</button>' +
                    '<button type="button" data-icwftog="auto">AUTO-PEGEL</button>' +
                    '<button type="button" data-ic-sk="center">CENTER</button>' +
                    '<button type="button" data-ic-sk="expand">EXPAND</button>' +
                  '</div></div>' +
                  '<div class="ic-wf-grp"><b>SPAN / TEMPO</b><div>' +
                    '<button type="button" data-ic-sk="span" data-feld="wfspanbtn">SPAN: FULL</button>' +
                    '<button type="button" data-ic-sk="speed" data-feld="wfspdbtn">TEMPO: FAST2</button>' +
                  '</div></div>' +
                '</div>' +
              '</div>' +

              '<div class="ic-pop" data-icpop="band">' +
                '<div class="ic-pop-hd"><span>HAM-BÄNDER &amp; PROFILE</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-pop-grid g5">' +
                  BAENDER.map(function (b) { return '<button type="button" data-band="' + b.n + '">' + b.n + '</button>'; }).join("") +
                '</div>' +
                '<button type="button" class="ic-pop-allprof" data-icopenprof="1">Alle Empfangsprofile im Menü öffnen ▸</button>' +
              '</div>' +

              '<div class="ic-pop" data-icpop="mode">' +
                '<div class="ic-pop-hd"><span>BETRIEBSART WÄHLEN</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-pop-grid g3">' +
                  MODI.map(function (m) { return '<button type="button" data-modus="' + m + '">' + m + '</button>'; }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ic-pop" data-icpop="mem">' +
                '<div class="ic-pop-hd"><span>SPEICHERKANÄLE</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-pop-list">' +
                  SPEICHER.map(function (sp, idx) {
                    return '<button type="button" data-mem="' + idx + '"><b>' + sp.n + '</b><span>' + hzKurz(sp.hz) + ' MHz · ' + sp.m + '</span></button>';
                  }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ic-pop" data-icpop="step">' +
                '<div class="ic-pop-hd"><span>ABSTIMMSCHRITT</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-pop-grid g3">' +
                  SCHRITTE.map(function (st) { return '<button type="button" data-step="' + st + '">' + schrittText(st) + '</button>'; }).join("") +
                '</div>' +
              '</div>' +

              '<div class="ic-pop" data-icpop="pad">' +
                '<div class="ic-pop-hd"><span>FREQUENZ EINGEBEN</span><button type="button" data-icpopx>×</button></div>' +
                '<div class="ic-pad-disp"><span data-feld="eingabe">—</span><small>MHz (.) / kHz</small></div>' +
                '<div class="ic-pad-grid">' +
                  padHtml +
                  '<button type="button" class="ic-pad-ent" data-tat="enter">ENT (ÜBERNEHMEN)</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            /* --- Linke Spalte Taster & Buchsen --- */
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(16, 45, 61, 69) + '" data-tat="pwr" title="POWER / VFO Lock (Shift+Klick: Display dimmen)"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(16, 72, 61, 96) + '" data-rxonly="1" title="TRANSMIT (WebSDR: reiner Empfänger)">TRANSMIT</button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(16, 99, 61, 123) + '" data-icpopopen="band" title="TUNER / Bänder &amp; Profile"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(16, 127, 61, 150) + '" data-cont="1" title="VOX/BK-IN / Audio-EQ"></button>' +
            '<button type="button" class="ic-spot ic-spot-jack" style="' + icBox(22, 162, 54, 186) + '" data-tat="mute" title="PHONES: Audio stumm / ein"></button>' +
            '<button type="button" class="ic-spot ic-spot-jack" style="' + icBox(15, 204, 62, 250) + '" data-icpopopen="level" title="MIC: Audio · Squelch · RF · DSP"></button>' +

            /* --- Linkes Drehregler- & DSP-Feld --- */
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(114, 38, 139, 49) + '" data-tat="filclr" title="TWIN PBT CLR: IF-Filter 2.4 kHz"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(72, 114, 104, 132) + '" data-ipobtn="1" title="P.AMP / ATT (Shift+Klick: ATT)"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(108, 114, 140, 132) + '" data-notch="1" title="NOTCH: Auto-Notch"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(72, 136, 104, 154) + '" data-nb="1" title="NB: Noise Blanker"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(108, 136, 140, 154) + '" data-dnr="1" title="NR: Rauschunterdrückung"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(76, 232, 139, 250) + '" data-icpopopen="mem" title="SD CARD / Speicherkanäle"></button>' +

            /* --- 5 Bezel-Tasten unter dem TFT --- */
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(171, 230, 217, 252) + '" data-tat="menu" title="MENU: Gerätemenü"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(221, 230, 267, 252) + '" data-icpopopen="level" title="FUNCTION: Audio · SQ · RF · DSP"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(271, 230, 317, 252) + '" data-ic-sk="smode" title="M.SCOPE: 2D / 3DSS / MULTI"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(321, 230, 367, 252) + '" data-icpopopen="wfopt" title="QUICK: Scope- &amp; Wasserfall-Optionen"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(371, 230, 417, 252) + '" data-tat="esc" title="EXIT: Overlay schließen / Eingabe löschen"></button>' +

            /* --- Mitte-Rechts Tasten --- */
            '<button type="button" class="ic-spot ic-spot-jack" style="' + icBox(440, 109, 474, 140) + '" data-ab="1" title="XFC: VFO-A ↔ VFO-B"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(436, 198, 468, 224) + '" data-zin="1" title="AUTO TUNE: auf nächste 1 kHz einrasten"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(436, 234, 474, 254) + '" data-ton="1" title="SPEECH / Bedienton ein/aus"></button>' +

            /* --- Rechts-Oben Tastenmatrix --- */
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(495, 42, 531, 60) + '" data-rit="1" title="RIT ein/aus"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(534, 42, 570, 60) + '" data-rxonly="1" title="ΔTX (WebSDR: reiner Empfänger)">ΔTX</button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(573, 42, 609, 60) + '" data-tat="dspreset" title="CLEAR: RIT &amp; DSP zurücksetzen"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(495, 63, 531, 81) + '" data-split="1" title="SPLIT ein/aus"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(534, 63, 570, 81) + '" data-ab="1" title="A/B: VFO-A ↔ VFO-B"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(573, 63, 609, 81) + '" data-icpopopen="mem" title="V/M: Speicherkanäle"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(495, 84, 531, 102) + '" data-ic-banddir="-1" title="Band abwärts"></button>' +
            '<button type="button" class="ic-spot ic-spot-key" style="' + icBox(534, 84, 570, 102) + '" data-ic-banddir="1" title="Band aufwärts"></button>' +
            '<button type="button" class="ic-spot ic-spot-jack" style="' + icBox(573, 84, 609, 115) + '" data-icpopopen="pad" title="MPAD: Direkte Frequenzeingabe"></button>' +

            /* --- 4 Reale Drehregler (inkl. Dual-Concentric AF innen / RF-SQL aussen) --- */
            '<div class="ic-knob" data-ick="pbt" style="' + icKnobBox(107.0, 77.5, 24.0) + '" title="TWIN PBT: IF-Filterbreite (Klick: 2.4 kHz)">' +
              '<canvas class="ic-knob-cv" data-knob="pbt" data-ang="-35"></canvas>' +
            '</div>' +
            '<div class="ic-knob ic-knob-outer" data-ick="rfsql" style="' + icKnobBox(107.0, 196.5, 26.0) + '" title="RF/SQL Ring: RF-Gain (Shift+Rad: Squelch, Klick: Level)">' +
              '<canvas class="ic-knob-cv" data-knob="rfsql" data-ang="0"></canvas>' +
            '</div>' +
            '<div class="ic-knob ic-knob-inner" data-ick="af" style="' + icKnobBox(107.0, 196.5, 14.8) + '" title="AF Regler: Lautstärke (Klick: Stumm)">' +
              '<canvas class="ic-knob-cv" data-knob="af" data-ang="45"></canvas>' +
            '</div>' +
            '<div class="ic-knob" data-ick="multi" style="' + icKnobBox(457.5, 73.5, 19.5) + '" title="MULTI: Abstimmschritt (oder RIT wenn aktiv) · Klick: Step">' +
              '<canvas class="ic-knob-cv" data-knob="multi" data-ang="-30"></canvas>' +
            '</div>' +
            '<div class="ic-knob ic-vfo-knob" data-feld="dial" style="' + icKnobBox(539.5, 186.5, 69.5) + '" title="Hauptabstimmrad: Ziehen, Mausrad oder Pfeiltasten">' +
              '<canvas class="ic-knob-cv" data-knob="vfo" data-ang="0"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="fg-eck tl" data-eck="tl" title="Größe ziehen (Doppelklick: Standard)"></div>' +
        '<div class="fg-eck tr" data-eck="tr" title="Größe ziehen (Doppelklick: Standard)"></div>' +
        '<div class="fg-eck bl" data-eck="bl" title="Größe ziehen (Doppelklick: Standard)"></div>' +
        '<div class="fg-eck br" data-eck="br" title="Größe ziehen (Doppelklick: Standard)"></div>' +
        '<button type="button" class="fg-wechsel" data-wechsel="1" title="Zu Funkgerät 1 wechseln">⇄ 1</button>' +
        '<button type="button" class="fg-zu" data-zu title="Funkgerät 3 schließen">×</button>' +
      '</div>';

    /* --- Popover-Steuerung --- */
    function icPopSchliessen() {
      Array.prototype.forEach.call(w.querySelectorAll(".ic-pop.offen"), function (p) { p.classList.remove("offen"); });
    }
    function icPopOeffnen(name) {
      var p = w.querySelector('[data-icpop="' + name + '"]');
      if (!p) { return; }
      var warOffen = p.classList.contains("offen");
      icPopSchliessen();
      if (!warOffen) {
        p.classList.add("offen");
        if (name === "level") { icTelemetrieSync(w); }
        if (name === "wfopt") { icWfOptSync(); }
      }
    }
    function icWfOptSync() {
      var curM3 = SCOPE.mode3 || "std";
      Array.prototype.forEach.call(w.querySelectorAll("[data-icwfmode]"), function (b) {
        b.classList.toggle("an", b.getAttribute("data-icwfmode") === curM3);
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-icwfpal]"), function (b) {
        b.classList.toggle("an", b.getAttribute("data-icwfpal") === SCOPE.palette);
      });
      var bPk = w.querySelector('[data-icwftog="peak"]'); if (bPk) { bPk.classList.toggle("an", !!SCOPE.peakHold); }
      var bAu = w.querySelector('[data-icwftog="auto"]'); if (bAu) { bAu.classList.toggle("an", !!SCOPE.autoLevel); }
      var bDir = w.querySelector('[data-feld="wfdirbtn"]');
      if (bDir) {
        bDir.textContent = SCOPE.wfDown ? "FLUSS: ABWÄRTS" : "FLUSS: AUFWÄRTS";
        bDir.classList.toggle("an", !SCOPE.wfDown);
      }
      var bC = w.querySelector('.ic-wf-opts [data-ic-sk="center"]'); if (bC) { bC.classList.toggle("an", !!SCOPE.centered); }
      var bE = w.querySelector('.ic-wf-opts [data-ic-sk="expand"]'); if (bE) { bE.classList.toggle("an", !!SCOPE.expand); }
      var bSp = w.querySelector('[data-feld="wfspanbtn"]');
      if (bSp) { bSp.textContent = "SPAN: " + (SCOPE.spanHz ? scopeSpanText(SCOPE.spanHz) : "FULL"); }
      var bSd = w.querySelector('[data-feld="wfspdbtn"]');
      if (bSd) { bSd.textContent = "TEMPO: " + (SCOPE_SPEEDS[SCOPE.speedIdx] ? SCOPE_SPEEDS[SCOPE.speedIdx].name : "FAST2"); }
    }
    function icToast(msg) {
      var g3 = Z.geraete[i];
      if (!g3) { return; }
      g3.meldung = msg;
      zeichnen();
      setTimeout(function () { if (g3.meldung === msg) { g3.meldung = ""; zeichnen(); } }, 2000);
    }

    Array.prototype.forEach.call(w.querySelectorAll("[data-icpopopen]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); icPopOeffnen(b.getAttribute("data-icpopopen")); };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-icpopx]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); icPopSchliessen(); };
    });
    var bOpenProf3 = w.querySelector('[data-icopenprof="1"]');
    if (bOpenProf3) {
      bOpenProf3.onclick = function (ev) {
        ev.stopPropagation(); fgKlick("taste"); icPopSchliessen(); menuZeigen(true, 4);
      };
    }

    /* --- Direkt-Ziffernblock & Tastatur --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-ziffer]"), function (t) {
      t.onclick = function () { fgKlick("taste"); tasteV1(i, t.dataset.ziffer); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="klar"]'), function (b) {
      b.onclick = function () { fgKlick("taste"); EINGABE[i] = ""; zeichnen(); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="enter"]'), function (b) {
      b.onclick = function () {
        if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
        var pad = w.querySelector('[data-icpop="pad"]');
        if (EINGABE[i]) {
          fgKlick("rast"); enterV1(i); icPopSchliessen();
        } else if (pad && !pad.classList.contains("offen")) {
          fgKlick("taste"); icPopOeffnen("pad");
        } else {
          icPopSchliessen();
        }
      };
    });
    var bEsc = w.querySelector('[data-tat="esc"]');
    if (bEsc) {
      bEsc.onclick = function () {
        fgKlick("taste");
        EINGABE[i] = "";
        icPopSchliessen();
        if (DW_STATE.aktiv) { dwStoppen(i); }
        if (SCAN_STATE.aktiv) { scanStoppen(i); }
        zeichnen();
      };
    }
    w.addEventListener("keydown", function (ev) {
      var pad = w.querySelector('[data-icpop="pad"]');
      if (!pad || !pad.classList.contains("offen")) { return; }
      if (/^[0-9.]$/.test(ev.key)) { ev.preventDefault(); tasteV1(i, ev.key); }
      else if (ev.key === "Backspace") { ev.preventDefault(); EINGABE[i] = EINGABE[i].slice(0, -1); zeichnen(); }
      else if (ev.key === "Enter") {
        ev.preventDefault();
        if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
        enterV1(i); icPopSchliessen();
      }
      else if (ev.key === "Escape") { ev.preventDefault(); icPopSchliessen(); }
    });

    /* --- Band / Modus / Speicher / Schritt --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-band]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var bd = BAENDER.filter(function (x) { return x.n === b.dataset.band; })[0];
        if (bd) { bandWaehlen(i, bd); }
        icPopSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-ic-banddir]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var dir = parseInt(b.getAttribute("data-ic-banddir") || "1", 10) || 1;
        var cur = bandVon(Z.geraete[i].hz);
        var idx = cur ? BAENDER.indexOf(cur) : 5;
        if (idx < 0) { idx = 5; }
        var nxt = BAENDER[(idx + dir + BAENDER.length) % BAENDER.length];
        if (nxt) { bandWaehlen(i, nxt); }
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-modus]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        Z.aktiv = i;
        Z.geraete.forEach(function (gg) { gg.modus = b.dataset.modus; });
        empfangenModus(b.dataset.modus);
        sichern(); zeichnen(); icPopSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-mem]"), function (b) {
      b.onclick = function () {
        if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
        fgKlick("rast");
        var sp = SPEICHER[parseInt(b.dataset.mem, 10)];
        if (sp) { Z.geraete[i].sp = parseInt(b.dataset.mem, 10); abstimmen(i, sp.hz, sp.m, sp.n); }
        icPopSchliessen();
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-step]"), function (b) {
      b.onclick = function () {
        fgKlick("rast");
        Z.geraete[i].schritt = parseInt(b.dataset.step, 10);
        sichern(); zeichnen(); icTelemetrieSync(w); icPopSchliessen();
      };
    });

    /* --- Scope & Softkeys --- */
    Array.prototype.forEach.call(w.querySelectorAll("[data-ic-sk]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var act = b.getAttribute("data-ic-sk");
        if (act === "center") {
          SCOPE.centered = !SCOPE.centered; scopeCfgSichern();
          icToast(SCOPE.centered ? "Scope: CENTER" : "Scope: FIX/Server");
        } else if (act === "smode") {
          var ord = ["std", "3d", "multi"];
          SCOPE.mode3 = ord[(ord.indexOf(SCOPE.mode3 || "std") + 1) % ord.length];
          scopeCfgSichern();
          icToast("Scope: " + (SCOPE.mode3 === "3d" ? "3D (3DSS)" : (SCOPE.mode3 === "multi" ? "MULTI" : "2D")));
        } else if (act === "span") {
          var idx = SCOPE_SPANS.indexOf(SCOPE.spanHz);
          SCOPE.spanHz = SCOPE_SPANS[(idx + 1) % SCOPE_SPANS.length];
          if (SCOPE.spanHz > 0) { SCOPE.centered = true; }
          scopeCfgSichern();
          icToast("Span: " + (SCOPE.spanHz ? scopeSpanText(SCOPE.spanHz) : "FULL"));
        } else if (act === "speed") {
          SCOPE.speedIdx = (SCOPE.speedIdx + 1) % SCOPE_SPEEDS.length;
          scopeCfgSichern();
          icToast("Tempo: " + SCOPE_SPEEDS[SCOPE.speedIdx].name);
        } else if (act === "expand") {
          SCOPE.expand = !SCOPE.expand; scopeCfgSichern();
          var box = w.querySelector(".ic-scr-scope");
          if (box) { box.classList.toggle("expand", !!SCOPE.expand); }
          icToast(SCOPE.expand ? "Scope: EXPAND" : "Scope: NORMAL");
        }
        icWfOptSync();
        scopeZeichnen(i, w, true);
        if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
        if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); }
      };
    });

    Array.prototype.forEach.call(w.querySelectorAll("[data-icwfmode]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        SCOPE.mode3 = b.getAttribute("data-icwfmode") || "std";
        scopeCfgSichern(); icWfOptSync();
        scopeZeichnen(i, w, true);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-icwfpal]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        SCOPE.palette = b.getAttribute("data-icwfpal") || "ft710";
        scopeCfgSichern(); icWfOptSync();
        scopeZeichnen(i, w, true);
        if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
        if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); }
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-icwftog]"), function (b) {
      b.onclick = function () {
        fgKlick("taste");
        var k = b.getAttribute("data-icwftog");
        if (k === "peak") { SCOPE.peakHold = !SCOPE.peakHold; }
        else if (k === "auto") { SCOPE.autoLevel = !SCOPE.autoLevel; }
        else if (k === "wfdir") { SCOPE.wfDown = !SCOPE.wfDown; }
        scopeCfgSichern(); icWfOptSync();
        scopeZeichnen(i, w, true);
        if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
        if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); }
      };
    });

    document.addEventListener("click", function (ev) {
      if (ev && ev.isTrusted === false) { return; }
      if (!w.querySelector(".ic-pop.offen")) { return; }
      if (ev.target && ev.target.closest && ev.target.closest(".ic-pop, [data-icpopopen], [data-tpill], [data-ick]")) { return; }
      icPopSchliessen();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && w.querySelector(".ic-pop.offen")) { icPopSchliessen(); }
    });

    var sc3 = w.querySelector('[data-feld="w3scope"]');
    if (sc3) {
      sc3.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      sc3.addEventListener("click", function (ev) {
        if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
        var r = sc3.getBoundingClientRect();
        if (!r || !(r.width > 10)) { return; }
        var curM3 = SCOPE.mode3 || "std";
        var relX = ev.clientX - r.left;
        var spanW = (curM3 === "multi") ? Math.max(10, r.width * 0.54) : Math.max(10, r.width - 6);
        var u = Math.max(0, Math.min(1, (curM3 === "multi" && relX > spanW) ? ((relX - spanW) / Math.max(10, r.width - spanW)) : (relX / spanW)));
        var win = scopeFensterBerechnen(Z.geraete[i]);
        var hz = Math.round(win.f0 + u * win.bw);
        abstimmen(i, hz, null, "Scope: " + hzKurz(hz) + " MHz");
      });
    }

    /* --- Tasten-Aktionen --- */
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="color3"]'), function (cb) {
      cb.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("taste");
        var cur = lichtIdLesen(2), idx = 0;
        for (var k = 0; k < LICHT_FARBEN.length; k++) { if (LICHT_FARBEN[k].id === cur) { idx = k; break; } }
        var next = LICHT_FARBEN[(idx + 1) % LICHT_FARBEN.length];
        lichtAnwenden(next.id, 2);
        icToast("COLOR: " + next.name);
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="dw"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("rast"); dwToggle(i); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="scan"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("rast"); scanToggle(i); };
    });
    Array.prototype.forEach.call(w.querySelectorAll('[data-tat="menu"]'), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); menuZeigen(true); };
    });
    var bPwr3 = w.querySelector('[data-tat="pwr"]');
    if (bPwr3) {
      bPwr3.onclick = function (ev) {
        ev.stopPropagation();
        fgKlick("rast");
        if (ev.shiftKey) {
          var scr = w.querySelector(".ic-screen-slot");
          if (scr) { scr.classList.toggle("dim"); }
          ledsSetzen(i, Z.geraete[i], w);
          icToast((scr && scr.classList.contains("dim")) ? "DISPLAY GEDIMMT" : "DISPLAY HELL");
          return;
        }
        Z.geraete[i].lockAn = !Z.geraete[i].lockAn;
        zeichnen();
        icToast(Z.geraete[i].lockAn ? "VFO GESPERRT (LOCK)" : "VFO FREI");
      };
    }

    /* P.AMP/ATT Shift+Klick support fuer ATT direkt auf der Taste */
    var bPamp = w.querySelector('[data-ipobtn="1"]');
    if (bPamp) {
      bPamp.onclick = function (ev) {
        fgKlick("rast");
        if (ev && ev.shiftKey) {
          var vals = [0, 10, 20];
          MENU_STAND.att = vals[(vals.indexOf(MENU_STAND.att || 0) + 1) % vals.length];
          menuStandSichern(); zeichnen();
          icToast(MENU_STAND.att ? ("ATT -" + MENU_STAND.att + " dB") : "ATT AUS");
          return;
        }
        MENU_STAND.pre = !MENU_STAND.pre; menuStandSichern(); zeichnen();
        icToast(MENU_STAND.pre ? "P.AMP EIN" : "P.AMP AUS");
      };
    }
    Array.prototype.forEach.call(w.querySelectorAll("[data-nb]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        MENU_STAND.nb = !MENU_STAND.nb; menuStandSichern();
        afSet("NB", MENU_STAND.nb); zeichnen();
        icToast("NB " + (MENU_STAND.nb ? "EIN" : "AUS"));
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-dnr]"), function (t) {
      t.onclick = function () {
        fgKlick("taste");
        MENU_STAND.nr = (MENU_STAND.nr + 1) % 4; menuStandSichern();
        nrSetzen(MENU_STAND.nr); afSet("NR", MENU_STAND.nr > 0);
        zeichnen(); icTelemetrieSync(w);
        icToast(MENU_STAND.nr ? ("NR STUFE " + MENU_STAND.nr) : "NR AUS");
      };
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-nar]"), function (t) {
      t.onclick = function () {
        fgKlick("rast");
        var bwList = [2400, 1800, 500, 3000];
        var idx = bwList.indexOf(MENU_STAND.filt || 2400);
        MENU_STAND.filt = bwList[(idx + 1) % bwList.length];
        menuStandSichern(); zeichnen(); icTelemetrieSync(w);
        icToast("FIL: " + (MENU_STAND.filt >= 1000 ? (MENU_STAND.filt / 1000).toFixed(1) + " kHz" : (MENU_STAND.filt + " Hz")));
      };
    });
    var bFilClr3 = w.querySelector('[data-tat="filclr"]');
    if (bFilClr3) {
      bFilClr3.onclick = function () {
        fgKlick("rast");
        MENU_STAND.filt = 2400; menuStandSichern(); zeichnen(); icTelemetrieSync(w);
        icToast("PBT CLR: 2.4 kHz");
      };
    }
    Array.prototype.forEach.call(w.querySelectorAll('[data-ton="1"]'), function (b) {
      b.onclick = function () {
        MENU_STAND.ton = !MENU_STAND.ton; menuStandSichern();
        if (MENU_STAND.ton) { fgKlick("rast"); }
        zeichnen(); icTelemetrieSync(w);
        icToast(MENU_STAND.ton ? "SPEECH / TON EIN" : "BEDIENTON AUS");
      };
    });
    var bMute3 = w.querySelector('[data-tat="mute"]');
    if (bMute3) {
      bMute3.onclick = function () {
        fgKlick("rast");
        var cur = volProzent();
        var nv = (cur > 0) ? (bMute3.dataset.prevVol = String(cur), 0) : (parseInt(bMute3.dataset.prevVol || "100", 10) || 100);
        volSetzen(nv); ledsSetzen(i, Z.geraete[i], w); icTelemetrieSync(w);
        icToast(nv === 0 ? "AUDIO STUMM" : ("VOL: " + nv + "%"));
      };
    }
    var bReset3 = w.querySelector('[data-tat="dspreset"]');
    if (bReset3) {
      bReset3.onclick = function () {
        fgKlick("rast");
        MENU_STAND.nb = false; MENU_STAND.nr = 0; MENU_STAND.notch = false; MENU_STAND.eq = false;
        afSet("NB", false); afSet("NR", false); afSet("Notch", false); afSet("EQ", false);
        Z.geraete.forEach(function (o) { o.ritAn = false; o.ritOff = 0; });
        EINGABE[i] = "";
        var scr = w.querySelector(".ic-screen-slot");
        if (scr) { scr.classList.remove("dim"); }
        menuStandSichern(); zeichnen(); icTelemetrieSync(w);
        icToast("CLEAR: RIT & DSP zurückgesetzt");
      };
    }

    /* --- Top-Bezel Telemetrie Pills & Inline Popover Sliders --- */
    var pVol = w.querySelector('[data-tpill="vol"]');
    if (pVol) {
      pVol.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var nv = volSetzen(volProzent() + (ev.deltaY < 0 ? 5 : -5));
        icTelemetrieSync(w); icToast("VOL: " + nv + "%");
      }, { passive: false });
      pVol.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); icPopOeffnen("level"); };
      pVol.ondblclick = function (ev) {
        ev.stopPropagation();
        var cur = volProzent();
        var nv = (cur > 0) ? (pVol.dataset.prevVol = String(cur), 0) : (parseInt(pVol.dataset.prevVol || "100", 10) || 100);
        volSetzen(nv); icTelemetrieSync(w);
        icToast(nv === 0 ? "AUDIO STUMM" : ("VOL: " + nv + "%"));
      };
    }
    var pSq = w.querySelector('[data-tpill="sq"]');
    if (pSq) {
      pSq.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var sq = (typeof MENU_STAND.squelch === "number" ? MENU_STAND.squelch : -150) + (ev.deltaY < 0 ? 5 : -5);
        sq = Math.max(-150, Math.min(0, Math.round(sq)));
        MENU_STAND.squelch = sq; menuStandSichern(); squelchSetzen(sq); reglerSyncAlle();
        icToast("SQUELCH: " + (sq <= -149 ? "AUS" : (sq + " dB")));
      }, { passive: false });
      pSq.onclick = function (ev) {
        ev.stopPropagation(); fgKlick("taste");
        var nv = (MENU_STAND.squelch > -149) ? -150 : -75;
        MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
        icToast(nv <= -149 ? "SQUELCH: AUS" : "SQUELCH: -75 dB");
      };
    }
    var pRf = w.querySelector('[data-tpill="rf"]');
    if (pRf) {
      pRf.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var cur = (typeof MENU_STAND.rf === "number") ? MENU_STAND.rf : 20;
        var nv = Math.max(RF_MIN, Math.min(RF_MAX, cur + (ev.deltaY < 0 ? 2 : -2)));
        rfAnwenden(nv);
        icToast("RF-GAIN: " + nv + " dB");
      }, { passive: false });
      pRf.onclick = function (ev) { ev.stopPropagation(); fgKlick("taste"); icPopOeffnen("level"); };
    }

    var slVol = w.querySelector('[data-lvl="vol"]');
    if (slVol) {
      slVol.addEventListener("input", function () { volSetzen(parseInt(slVol.value, 10)); icTelemetrieSync(w); });
    }
    var slSq = w.querySelector('[data-lvl="sq"]');
    if (slSq) {
      slSq.addEventListener("input", function () {
        var nv = parseInt(slSq.value, 10);
        MENU_STAND.squelch = nv; menuStandSichern(); squelchSetzen(nv); reglerSyncAlle();
      });
    }
    var slRf = w.querySelector('[data-lvl="rf"]');
    if (slRf) {
      slRf.addEventListener("input", function () { rfAnwenden(parseInt(slRf.value, 10)); });
    }
    Array.prototype.forEach.call(w.querySelectorAll('[data-asc="1"]'), function (bAsc) {
      bAsc.onclick = function () {
        fgKlick("rast");
        var autoSq = (MENU_STAND.squelch > -149) ? -150 : -68;
        MENU_STAND.squelch = autoSq; menuStandSichern(); squelchSetzen(autoSq); reglerSyncAlle();
        icToast(autoSq <= -149 ? "ASC: AUS" : "ASC (-68 dB)");
      };
    });

    /* --- Drehknopf-Controller --- */
    function bindIcEncoder(name, onStep, onClick) {
      var wrap = w.querySelector('[data-ick="' + name + '"]');
      if (!wrap) { return; }
      var st = { drag: false, ly: 0, acc: 0, moved: false };
      function onMove(ev) {
        if (!st.drag) { return; }
        var dy = st.ly - ev.clientY;
        st.ly = ev.clientY;
        st.acc += dy;
        while (Math.abs(st.acc) >= 5) {
          var dir = st.acc > 0 ? 1 : -1;
          st.acc -= dir * 5;
          st.moved = true;
          fgKlick("dial");
          onStep(dir, ev);
        }
        ev.stopPropagation();
        if (ev.cancelable && ev.preventDefault) { ev.preventDefault(); }
      }
      function onDone(ev, allowClick) {
        if (!st.drag) { return; }
        st.drag = false;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("blur", onCancel, true);
        if (allowClick && !st.moved && typeof onClick === "function") { fgKlick("rast"); onClick(ev); }
      }
      function onUp(ev) { onDone(ev, true); }
      function onCancel(ev) { onDone(ev, false); }

      wrap.addEventListener("pointerdown", function (ev) {
        if (ev && ev.button && ev.button !== 0) { return; }
        ev.preventDefault(); ev.stopPropagation();
        st.drag = true; st.ly = ev.clientY; st.acc = 0; st.moved = false;
        window.addEventListener("pointermove", onMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onCancel, true);
        window.addEventListener("blur", onCancel, true);
      });
      wrap.addEventListener("wheel", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        fgKlick("dial");
        onStep(ev.deltaY < 0 ? 1 : -1, ev);
      }, { passive: false });
    }

    bindIcEncoder("pbt", function (dir) {
      var bwL = [3000, 2400, 1800, 500];
      var idx = (bwL.indexOf(MENU_STAND.filt || 2400) + (dir > 0 ? 1 : 3)) % 4;
      MENU_STAND.filt = bwL[idx]; menuStandSichern(); zeichnen(); icTelemetrieSync(w);
      icToast("FILTER: " + (MENU_STAND.filt >= 1000 ? (MENU_STAND.filt / 1000).toFixed(1) + " kHz" : (MENU_STAND.filt + " Hz")));
    }, function () {
      MENU_STAND.filt = 2400; menuStandSichern(); zeichnen(); icTelemetrieSync(w);
      icToast("TWIN PBT CLR: 2.4 kHz");
    });

    bindIcEncoder("af", function (dir) {
      var nv = volSetzen(volProzent() + dir * 5);
      icTelemetrieSync(w);
      icToast("AF VOL: " + nv + "%");
    }, function () {
      var bm = w.querySelector('[data-tat="mute"]');
      if (bm) { bm.click(); }
    });

    bindIcEncoder("rfsql", function (dir, ev) {
      if (ev && ev.shiftKey) {
        var sq = (typeof MENU_STAND.squelch === "number" ? MENU_STAND.squelch : -150) + dir * 5;
        sq = Math.max(-150, Math.min(0, Math.round(sq)));
        MENU_STAND.squelch = sq; menuStandSichern(); squelchSetzen(sq); reglerSyncAlle();
        icToast("SQUELCH: " + (sq <= -149 ? "AUS" : (sq + " dB")));
      } else {
        var cur = (typeof MENU_STAND.rf === "number") ? MENU_STAND.rf : 20;
        var nv = Math.max(RF_MIN, Math.min(RF_MAX, cur + dir * 2));
        rfAnwenden(nv);
        icToast("RF-GAIN: " + nv + " dB");
      }
    }, function () {
      icPopOeffnen("level");
    });

    bindIcEncoder("multi", function (dir) {
      var gg = Z.geraete[i];
      if (gg.ritAn) {
        gg.ritOff = Math.max(-9990, Math.min(9990, (gg.ritOff || 0) + dir * 10));
        abstimmen(i, gg.hz + dir * 10, null, "RIT " + (gg.ritOff >= 0 ? "+" : "") + gg.ritOff + " Hz");
        icTelemetrieSync(w);
        return;
      }
      var idx = SCHRITTE.indexOf(gg.schritt); if (idx < 0) { idx = 2; }
      gg.schritt = SCHRITTE[Math.max(0, Math.min(SCHRITTE.length - 1, idx + dir))];
      sichern(); zeichnen(); icTelemetrieSync(w);
      icToast("STEP: " + schrittText(gg.schritt));
    }, function () {
      icPopOeffnen("step");
    });

    radBinden(w.querySelector('[data-feld="dial"]'), function (richtung) {
      if (Z.geraete[i].lockAn) { icToast("VFO GESPERRT (LOCK)"); return; }
      if (SCAN_STATE.aktiv) { scanStoppen(i); }
      var cv = w.querySelector('canvas[data-knob="vfo"]');
      if (cv) {
        cv.dataset.ang = String((parseFloat(cv.dataset.ang || "0") + richtung * 15) % 360);
        icKnobsRedraw(w);
      }
      drehen(i, richtung);
    });

    g._smeter = meterBauenV3(w.querySelector('[data-feld="smeter"]'));
    bindenErweitert(w, i);
    griffBinden(w, g);
    resizeBinden(w, g);
    schliessenBinden(w, g);
    document.body.appendChild(w);
    resizeAnwenden(w, g);
    lichtAnwenden(lichtIdLesen(2), 2);
    icTelemetrieSync(w);
    setTimeout(function () { resizeAnwenden(w, g); scopeZeichnen(i, w, true); icTelemetrieSync(w); }, 90);
    return w;
  }

  /* ================= Zeichnen ========================================== */
  function zeichnen() {
    Z.geraete.forEach(function (g, i) {
      var w = FENSTER[i];
      if (!w) { return; }
      w.style.display = g.offen ? "" : "none";
      if (!g.offen) { return; }
      /* Startplatz: Geraet 1 und Geraet 2 nebeneinander
         unten. Passt es nicht in die Breite, wird gestapelt. Die Masse
         werden gemessen - geraten ueberlappen sich die Pulte. */
      var B1 = Z.geraete[0].w || 800, B2 = Z.geraete[1].w || 766, B3 = (Z.geraete[2] && Z.geraete[2].w) || 720, LUFT = 14, RAND = 10;
      resizeAnwenden(w, g);
      var vw = window.innerWidth || 1600;
      var px = g.x;
      if (px === null || px === undefined) {
        if (i === 2) {
          var o0 = !!(Z.geraete[0] && Z.geraete[0].offen);
          var o1 = !!(Z.geraete[1] && Z.geraete[1].offen);
          if (!o0 && !o1) { px = Math.max(RAND, Math.round((vw - B3) / 2)); }
          else if (o0 && o1 && vw >= B1 + B2 + B3 + LUFT * 2 + RAND * 2) { px = RAND + B1 + B2 + LUFT * 2; }
          else if (o0 && !o1 && vw >= B1 + B3 + LUFT + RAND * 2) { px = RAND + B1 + LUFT; }
          else if (!o0 && o1 && vw >= B2 + B3 + LUFT + RAND * 2) { px = RAND; }
          else { px = Math.max(RAND, Math.round((vw - B3) / 2)); }
        } else if (vw >= B1 + B2 + LUFT + RAND * 2) {
          px = (i === 0) ? RAND : (RAND + B1 + LUFT);
        } else {
          px = Math.max(RAND, vw - ((g.art === "v1") ? B1 : B2) - RAND);
        }
      }
      w.style.left = px + "px";
      if (g.y === null || g.y === undefined) {
        var unten = 42;
        if (i === 2) {
          var o0y = !!(Z.geraete[0] && Z.geraete[0].offen);
          var o1y = !!(Z.geraete[1] && Z.geraete[1].offen);
          if (o0y && o1y && vw < B1 + B2 + B3 + LUFT * 2 + RAND * 2) {
            var maxH = 0;
            [0, 1].forEach(function (kk) {
              if (FENSTER[kk] && Z.geraete[kk].offen) { maxH = Math.max(maxH, FENSTER[kk].offsetHeight || 314); }
            });
            unten += maxH + LUFT;
          } else if ((o0y && !o1y && vw < B1 + B3 + LUFT + RAND * 2) || (!o0y && o1y && vw < B2 + B3 + LUFT + RAND * 2)) {
            var vorSolo = FENSTER[o0y ? 0 : 1];
            if (vorSolo) { unten += (vorSolo.offsetHeight || 314) + LUFT; }
          }
        } else {
          var nebeneinander = vw >= B1 + B2 + LUFT + RAND * 2;
          if (!nebeneinander && i > 0) {
            for (var k = 0; k < i; k++) {
              var vor = FENSTER[k];
              if (vor && Z.geraete[k].offen) { unten += vor.offsetHeight + LUFT; }
            }
          }
        }
        w.style.top = "auto";
        w.style.bottom = unten + "px";
      } else {
        w.style.top = g.y + "px";
        w.style.bottom = "auto";
      }
      fensterKlemmen(w, g);
      if (g.art === "v1") { zeichnenV1(i, g, w); } else if (g.art === "v2") { zeichnenV2(i, g, w); } else { zeichnenV3(i, g, w); }
      if (g._smeter) { var _pj = pegelJetzt(), _pkj = (SM_PEAK[i] && SM_PEAK[i].v) || _pj; if (g._smeter.meterV2) { meterSetzenV2(g._smeter, _pj, _pkj); } else if (g._smeter.meterV3) { meterSetzenV3(g._smeter, _pj, _pkj); } else if (g._smeter.balken) { bogenSetzen(g._smeter, _pj, _pkj); } else { smeterSetzen(g._smeter, _pj); } }
      ledsSetzen(i, g, w);
      var dbf = w.querySelector('[data-feld="db"]');
      if (dbf) { var _db = smeterDb(); dbf.textContent = (_db === null) ? "—" : (_db.toFixed(1) + " dB"); }
    });
  }

  function zeichnenV1(i, g, w) {
    var bd = bandVon(g.hz);
    var fEl = w.querySelector('[data-feld="freq"]');
    if (fEl) { fEl.innerHTML = hzText(g.hz) + "<small>Hz</small>"; }
    var mB = w.querySelector('[data-feld="modusbox"]');
    if (mB) { mB.textContent = g.modus; }
    var smB = w.querySelector('[data-feld="submode"]');
    if (smB) { smB.textContent = g.modus; }
    var f2 = w.querySelector('[data-feld="freqb2"]');
    if (f2) { f2.innerHTML = hzText(g.b || g.hz) + "<small>Hz</small>"; }

    scopeZeichnen(i, w, false);

    var bi1 = demodBandInfo();
    var bw1 = Math.max(100, Math.round(Math.abs((bi1.hi || 2400) - (bi1.lo || -2400))));
    var bwTxt1 = bw1 >= 1000 ? ((bw1 / 1000).toFixed(1).replace(".", ",") + " kHz") : (bw1 + " Hz");
    var mEl = w.querySelector('[data-feld="meta"]');
    if (mEl) {
      mEl.textContent = g.modus + " · FIL " + bwTxt1 + " · " + schrittText(g.schritt) + (g.ritAn ? " · CLAR" : "");
    }
    var stEl = w.querySelector('[data-feld="status"]');
    if (stEl) { stEl.textContent = g.meldung || (DW_STATE.aktiv ? "DW AKTIV" : (SCAN_STATE.aktiv ? "SCAN LÄUFT" : "BEREIT")); }

    passbandAktualisieren(w, false);
    try {
      var iVa = w.querySelector('[data-ind="vfoa"]');
      var iVb = w.querySelector('[data-ind="vfob"]');
      if (iVa) { iVa.classList.toggle("aktiv", !g.vfoB); }
      if (iVb) { iVb.classList.toggle("aktiv", !!(g.vfoB || g.splitAn || DW_STATE.aktiv)); }

      var iDw = w.querySelector('[data-ind="dw"]');
      var iSc = w.querySelector('[data-ind="scn"]');
      var iLk = w.querySelector('[data-ind="lck"]');
      if (iDw) { iDw.classList.toggle("an", !!DW_STATE.aktiv); }
      if (iSc) { iSc.classList.toggle("an", !!SCAN_STATE.aktiv); }
      if (iLk) { iLk.classList.toggle("an", !!g.lockAn); }

      var bDw = w.querySelector('[data-tat="dw"]');
      var bSc = w.querySelector('[data-tat="scan"]');
      if (bDw) { bDw.classList.toggle("an", !!DW_STATE.aktiv); }
      if (bSc) { bSc.classList.toggle("an", !!SCAN_STATE.aktiv); }

      var togAll = function (sel, on) {
        Array.prototype.forEach.call(w.querySelectorAll(sel), function (el) { el.classList.toggle("an", !!on); });
      };
      togAll("[data-nb]", !!MENU_STAND.nb);
      togAll("[data-dnr]", (MENU_STAND.nr || 0) > 0);
      togAll("[data-nar]", (MENU_STAND.filt || 2400) < 2400);
      togAll("[data-fine]", g.schritt === 10 || g.schritt >= 5000);
      togAll('[data-tat="pwr"]', !!g.lockAn);
      togAll("[data-notch]", !!MENU_STAND.notch);
      togAll("[data-cont]", !!MENU_STAND.eq);
      togAll("[data-split]", !!g.splitAn);
      togAll("[data-rit]", !!g.ritAn);
      togAll("[data-attbtn]", !!(MENU_STAND.att));
      togAll("[data-ipobtn]", !!MENU_STAND.pre);
      togAll("[data-agcbtn]", String(MENU_STAND.agc || "auto") !== "auto");
    } catch (eU1) { }

    var einEl = w.querySelector('[data-feld="eingabe"]');
    if (einEl) { einEl.textContent = EINGABE[i] || "—"; }

    Array.prototype.forEach.call(w.querySelectorAll("[data-band]"), function (b) {
      b.classList.toggle("an", !!(bd && b.dataset.band === bd.n));
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-modus]"), function (b) {
      b.classList.toggle("an", b.dataset.modus === g.modus);
    });
    Array.prototype.forEach.call(w.querySelectorAll("[data-step]"), function (b) {
      b.classList.toggle("an", parseInt(b.dataset.step, 10) === g.schritt);
    });
    ftTelemetrieSync(w);
  }

  function zeichnenV2(i, g, w) {
    var fEl = w.querySelector('[data-feld="freq"]');
    if (fEl) { fEl.innerHTML = hzText(g.hz) + "<small>Hz</small>"; }
    var mEl = w.querySelector('[data-feld="modus"]');
    if (mEl) { mEl.textContent = g.modus; }
    var stEl = w.querySelector('[data-feld="schritt"]');
    if (stEl) { stEl.textContent = schrittText(g.schritt); }
    var f2 = w.querySelector('[data-feld="freqb2"]');
    if (f2) { f2.innerHTML = hzText(g.b || g.hz) + "<small>Hz</small>"; }
    var vt2 = w.querySelector('[data-feld="vfotag"]');
    if (vt2) { vt2.textContent = g.vfoB ? "VFO-B" : "VFO-A"; }
    Array.prototype.forEach.call(w.querySelectorAll('[data-feld="eingabe"]'), function (el) {
      el.textContent = EINGABE[i] || "—";
    });

    scopeZeichnen(i, w, false);
    passbandAktualisieren(w, true);

    var bi2 = demodBandInfo();
    var bw2 = Math.max(100, Math.round(Math.abs((bi2.hi || 2400) - (bi2.lo || -2400))));
    var bwTxt2 = bw2 >= 1000 ? ((bw2 / 1000).toFixed(1).replace(".", ",") + " kHz") : (bw2 + " Hz");
    var metaEl = w.querySelector('[data-feld="meta"]');
    if (metaEl) {
      metaEl.textContent = g.modus + " · FIL " + bwTxt2 + " · " + schrittText(g.schritt) + (g.ritAn ? " · RIT" : "");
    }
    var stF = w.querySelector('[data-feld="status"]');
    if (stF) {
      stF.textContent = g.meldung || (DW_STATE.aktiv ? "DW AKTIV" : (SCAN_STATE.aktiv ? "SCAN LÄUFT" : "BEREIT"));
    }

    try {
      var iDw = w.querySelector('[data-ind="dw"]');
      var iSc = w.querySelector('[data-ind="scn"]');
      var iLk = w.querySelector('[data-ind="lck"]');
      if (iDw) { iDw.classList.toggle("an", !!DW_STATE.aktiv); }
      if (iSc) { iSc.classList.toggle("an", !!SCAN_STATE.aktiv); }
      if (iLk) { iLk.classList.toggle("an", !!g.lockAn); }

      var togAll = function (sel, on) {
        Array.prototype.forEach.call(w.querySelectorAll(sel), function (el) { el.classList.toggle("an", !!on); });
      };
      togAll('[data-tat="dw"]', !!DW_STATE.aktiv);
      togAll('[data-tat="scan"]', !!SCAN_STATE.aktiv);
      togAll('[data-tat="pwr"]', !!g.lockAn);
      togAll("[data-lock2]", !!g.lockAn);
      togAll("[data-nb]", !!MENU_STAND.nb);
      togAll("[data-dnr]", (MENU_STAND.nr || 0) > 0);
      togAll("[data-nar]", (MENU_STAND.filt || 2400) < 2400);
      togAll("[data-fine]", g.schritt <= 10 || g.schritt >= 5000);
      togAll("[data-notch]", !!MENU_STAND.notch);
      togAll("[data-cont]", !!MENU_STAND.eq);
      togAll("[data-asc]", (typeof MENU_STAND.squelch === "number" && MENU_STAND.squelch > -149));
      togAll("[data-split]", !!g.splitAn);
      togAll("[data-rit]", !!g.ritAn);
      togAll("[data-ab]", !!g.vfoB);
      togAll("[data-attbtn]", !!(MENU_STAND.att));
      togAll("[data-ipobtn]", !!MENU_STAND.pre);
      togAll("[data-agcbtn]", String(MENU_STAND.agc || "auto") !== "auto");

      var bd = bandVon(g.hz);
      Array.prototype.forEach.call(w.querySelectorAll("[data-band]"), function (b) {
        b.classList.toggle("an", !!(bd && b.dataset.band === bd.n));
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-ts-keyband]"), function (b) {
        b.classList.toggle("an", !!(bd && b.getAttribute("data-ts-keyband") === bd.n));
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-modus]"), function (b) {
        b.classList.toggle("an", b.dataset.modus === g.modus);
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-tsmode]"), function (b) {
        var md = b.getAttribute("data-tsmode");
        var on = (md === "LSB/USB" && (g.modus === "LSB" || g.modus === "USB")) ||
                 (md === "FM/AM" && (g.modus === "FM" || g.modus === "AM")) ||
                 (md === g.modus);
        b.classList.toggle("an", on);
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-step]"), function (b) {
        b.classList.toggle("an", parseInt(b.dataset.step, 10) === g.schritt);
      });
    } catch (eU2) { }
    tsTelemetrieSync(w);
  }


  function zeichnenV3(i, g, w) {
    var fEl = w.querySelector('[data-feld="freq"]');
    if (fEl) { fEl.innerHTML = hzText(g.hz) + "<small>Hz</small>"; }
    var mEl = w.querySelector('[data-feld="modus"]');
    if (mEl) { mEl.textContent = g.modus; }
    var stEl = w.querySelector('[data-feld="schritt"]');
    if (stEl) { stEl.textContent = schrittText(g.schritt); }
    var f2 = w.querySelector('[data-feld="freqb2"]');
    if (f2) { f2.innerHTML = hzText(g.b || g.hz) + "<small>Hz</small>"; }
    var vt = w.querySelector('[data-feld="vfotag"]');
    if (vt) { vt.textContent = g.vfoB ? "VFO B" : "VFO A"; }
    Array.prototype.forEach.call(w.querySelectorAll('[data-feld="eingabe"]'), function (el) {
      el.textContent = EINGABE[i] || "—";
    });

    scopeZeichnen(i, w, false);
    passbandAktualisieren(w, true);

    var bi3 = demodBandInfo();
    var bw3 = Math.max(100, Math.round(Math.abs((bi3.hi || 2400) - (bi3.lo || -2400))));
    var bwTxt3 = bw3 >= 1000 ? ((bw3 / 1000).toFixed(1).replace(".", ",") + " kHz") : (bw3 + " Hz");
    var metaEl = w.querySelector('[data-feld="meta"]');
    if (metaEl) {
      metaEl.textContent = g.modus + " · FIL " + bwTxt3 + " · " + schrittText(g.schritt) + (g.ritAn ? " · RIT" : "");
    }
    var stF = w.querySelector('[data-feld="status"]');
    if (stF) {
      stF.textContent = g.meldung || (DW_STATE.aktiv ? "DW AKTIV" : (SCAN_STATE.aktiv ? "SCAN LÄUFT" : "BEREIT"));
    }

    try {
      var iDw = w.querySelector('[data-ind="dw"]');
      var iSc = w.querySelector('[data-ind="scn"]');
      var iLk = w.querySelector('[data-ind="lck"]');
      if (iDw) { iDw.classList.toggle("an", !!DW_STATE.aktiv); }
      if (iSc) { iSc.classList.toggle("an", !!SCAN_STATE.aktiv); }
      if (iLk) { iLk.classList.toggle("an", !!g.lockAn); }

      var togAll = function (sel, on) {
        Array.prototype.forEach.call(w.querySelectorAll(sel), function (el) { el.classList.toggle("an", !!on); });
      };
      togAll('[data-tat="dw"]', !!DW_STATE.aktiv);
      togAll('[data-tat="scan"]', !!SCAN_STATE.aktiv);
      togAll('[data-tat="pwr"]', !!g.lockAn);
      togAll("[data-nb]", !!MENU_STAND.nb);
      togAll("[data-dnr]", (MENU_STAND.nr || 0) > 0);
      togAll("[data-nar]", (MENU_STAND.filt || 2400) < 2400);
      togAll("[data-notch]", !!MENU_STAND.notch);
      togAll("[data-cont]", !!MENU_STAND.eq);
      togAll("[data-asc]", (typeof MENU_STAND.squelch === "number" && MENU_STAND.squelch > -149));
      togAll("[data-split]", !!g.splitAn);
      togAll("[data-rit]", !!g.ritAn);
      togAll("[data-ab]", !!g.vfoB);
      togAll("[data-attbtn]", !!(MENU_STAND.att));
      togAll("[data-ipobtn]", !!MENU_STAND.pre);
      togAll("[data-agcbtn]", String(MENU_STAND.agc || "auto") !== "auto");

      var bd = bandVon(g.hz);
      Array.prototype.forEach.call(w.querySelectorAll("[data-band]"), function (b) {
        b.classList.toggle("an", !!(bd && b.dataset.band === bd.n));
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-modus]"), function (b) {
        b.classList.toggle("an", b.dataset.modus === g.modus);
      });
      Array.prototype.forEach.call(w.querySelectorAll("[data-step]"), function (b) {
        b.classList.toggle("an", parseInt(b.dataset.step, 10) === g.schritt);
      });
    } catch (eU3) { }
    icTelemetrieSync(w);
  }

  /* ================= GERÄTEMENÜ (alle drei Geräte) =====================
     [MENÜ NEU] 20.11.2026
     Vorher öffnete "MENÜ" eine Profil-Liste - das war kein Gerätemenü, sondern
     eine Senderliste. Jetzt gibt es ein echtes Gerätemenü mit Reitern:

       EMPFANG · SENDEN/NETZ · ANZEIGE · SPEICHER · PROFILE · GERÄT

     Alle Einstellungen wirken sofort und werden im Browser gemerkt. Was der
     Empfänger nicht kann (z.B. Senden, TX-Leistung), steht ausdrücklich als
     "am Empfänger nicht verfügbar" da - nichts wird vorgetäuscht. */
  var MENUE = null;
  var MENUE_REITER = 0;
  var MENU_STAND = {
    agc: "auto",      /* auto | schnell | mittel | langsam | aus */
    nr: 0,            /* Rauschunterdrückung 0..3 */
    nb: false,        /* Rauschblanker */
    att: 0,           /* Dämpfung 0 | 10 | 20 dB */
    pre: true,        /* Vorverstärker */
    filt: 2400,       /* Bandbreite in Hz */
    squelch: -150,    /* dB, wie im Empfänger */
    rf: null,         /* RF-Gain in dB, null = AGC/automatisch */
    hell: 100,        /* Displayhelligkeit in Prozent */
    leds: true,       /* LED-Feld an */
    ton: true,        /* Tastenton */
    zeit: false,      /* Uhrzeit im Fuß */
    vol: 100,         /* Lautstaerke in Prozent (0..150) */
    scanModus: "band",/* band | speicher | ham */
    scanTempo: "mittel", /* schnell | mittel | langsam */
    scanSchwelle: 10, /* dB ueber Rauschsockel wenn SQ=AUS */
    speicher: [],     /* eigene Speicherkanäle */
    netz: false       /* reines Hörgerät: Senden gibt es nicht */
  };

  function menuStandLaden() {
    try {
      var r = JSON.parse(localStorage.getItem("dnx.fg.menu") || "null");
      if (r) { for (var k in r) { if (k in MENU_STAND) { MENU_STAND[k] = r[k]; } } }
    } catch (e) { }
  }
  function menuStandSichern() {
    try { localStorage.setItem("dnx.fg.menu", JSON.stringify(MENU_STAND)); } catch (e) { }
  }

  function menuBauen() {
    if (MENUE) { return MENUE; }
    var m = document.createElement("div");
    m.id = "fg-menu";
    m.innerHTML =
      '<div class="fgm-kopf"><b>MENÜ</b>' +
        '<div class="fgm-reiter" data-feld="reiter"></div>' +
        '<span class="fgm-zu" title="schließen">&#215;</span>' +
      '</div>' +
      '<div class="fgm-jetzt" data-feld="jetzt">—</div>' +
      '<div class="fgm-koerper" data-feld="koerper"></div>';
    m.querySelector(".fgm-zu").onclick = function () { menuZeigen(false); };
    document.body.appendChild(m);
    MENUE = m;
    return m;
  }

  var REITER = [
    ["empfang", "EMPFANG"],
    ["netz", "SENDEN · NETZ"],
    ["anzeige", "ANZEIGE"],
    ["speicher", "SPEICHER"],
    ["profile", "PROFILE"],
    ["geraet", "GERÄT"]
  ];

  function menuZeigen(ja, reiter) {
    var m = menuBauen();
    if (ja === false) { m.style.display = "none"; return; }
    if (typeof reiter === "number") { MENUE_REITER = reiter; }
    m.style.display = "block";
    menuFuellen();
  }

  function mZeile(titel, hinweis, inhalt) {
    return '<div class="fgm-zeile"><div class="fgm-ztext"><b>' + titel + '</b>' +
           (hinweis ? '<s>' + hinweis + '</s>' : '') + '</div>' +
           '<div class="fgm-zrecht">' + inhalt + '</div></div>';
  }
  function mWahl(name, werte, jetzt) {
    var h = '<div class="fgm-wahl">';
    werte.forEach(function (w) {
      h += '<button class="fgm-knopf' + (String(w[0]) === String(jetzt) ? " an" : "") +
           '" data-set="' + name + '" data-wert="' + w[0] + '">' + w[1] + '</button>';
    });
    return h + '</div>';
  }

  function menuFuellen() {
    var m = menuBauen();
    /* Reiter */
    var rk = m.querySelector('[data-feld="reiter"]');
    rk.innerHTML = REITER.map(function (r, i) {
      return '<button class="fgm-rk' + (i === MENUE_REITER ? " an" : "") +
             '" data-reiter="' + i + '">' + r[1] + '</button>';
    }).join("");
    Array.prototype.forEach.call(rk.querySelectorAll(".fgm-rk"), function (b) {
      b.onclick = function () { MENUE_REITER = parseInt(b.dataset.reiter, 10); menuFuellen(); };
    });

    /* Jetzt-Zeile */
    var g = Z.geraete[Z.aktiv] || Z.geraete[0] || {};
    m.querySelector('[data-feld="jetzt"]').innerHTML =
      "Gerät " + (Z.aktiv + 1) + " &nbsp;·&nbsp; <b>" + hzKurz(g.hz || 0) + " MHz</b> " +
      (g.modus || "") + " &nbsp;·&nbsp; " + (profilNameKurz() || "—");

    var h = "";
    var r = REITER[MENUE_REITER][0];

    if (r === "empfang") {
      var curB = bandVon(g.hz || 0);
      h += mZeile("HAM-BÄNDER", "Direktwahl (schaltet passendes HAM-Profil um)",
        mWahl("hamband", BAENDER.map(function (b) { return [b.n, b.n]; }), curB ? curB.n : ""));
      h += mZeile("BETRIEBSART", "gilt für alle drei Geräte (ein Empfänger)",
        mWahl("modus", MODI.map(function (x) { return [x, x]; }), g.modus));
      h += mZeile("BANDBREITE", "ZF-Filter",
        mWahl("filt", [[2400, "2,4 kHz"], [3000, "3 kHz"], [1800, "1,8 kHz"],
                       [500, "500 Hz"], [250, "250 Hz"]], MENU_STAND.filt));
      h += mZeile("AGC", "automatische Verstärkungsregelung",
        mWahl("agc", [["schnell", "SCHNELL"], ["mittel", "MITTEL"], ["langsam", "LANGSAM"],
                      ["aus", "AUS"]], MENU_STAND.agc));
      h += mZeile("RAUSCHUNTERDRÜCKUNG (NR)", "Stufen 0 – 3",
        mWahl("nr", [[0, "0"], [1, "1"], [2, "2"], [3, "3"]], MENU_STAND.nr));
      h += mZeile("RAUSCHBLANKER (NB)", "Impulsstörungen",
        mWahl("nb", [[0, "AUS"], [1, "AN"]], MENU_STAND.nb ? 1 : 0));
      h += mZeile("DÄMPFUNG (ATT)", "Eingangsdämpfer",
        mWahl("att", [[0, "AUS"], [10, "10 dB"], [20, "20 dB"]], MENU_STAND.att));
      h += mZeile("VORVERSTÄRKER (PRE)", "rauscharmer Eingang",
        mWahl("pre", [[0, "AUS"], [1, "AN"]], MENU_STAND.pre ? 1 : 0));
      h += mZeile("SQUELCH (SQ)", "Rauschsperre · " + menueSqText(),
        '<input type="range" class="fgm-schieber" data-set="squelch" min="-150" max="0" step="1" value="' + MENU_STAND.squelch + '">' +
        '<span class="fgm-wert" data-feld="sqwert">' + menueSqText() + '</span>');
      var rfSub = _rfState.qDirect ? "Q-Direct aktiv – Tuner umgangen (RF-Gain ohne Wirkung)" :
                  (!_rfState.darfAendern ? "Nur ansehen – zum Ändern anmelden" :
                   ("Verstärkung · aktuell " + (_rfState.modus === "auto" ? "AGC" : ((MENU_STAND.rf === null ? 20 : MENU_STAND.rf) + " dB"))));
      h += mZeile("RF-GAIN", rfSub,
        '<input type="range" class="fgm-schieber" data-set="rf" min="' + RF_MIN + '" max="' + RF_MAX + '" step="1" value="' + (MENU_STAND.rf === null ? 20 : MENU_STAND.rf) + '"' + (_rfState.darfAendern ? "" : " disabled") + '>' +
        '<span class="fgm-wert" data-feld="rfwert">' + (_rfState.modus === "auto" ? "AGC" : ((MENU_STAND.rf === null ? 20 : MENU_STAND.rf) + " dB")) + '</span>');
      h += mZeile("LAUTSTÄRKE (VOL)", "Audio-Ausgang des Empfängers (0 – 150 %)",
        '<input type="range" class="fgm-schieber" data-set="vol" min="0" max="150" step="1" value="' + volProzent() + '">' +
        '<span class="fgm-wert" data-feld="volwert">' + volProzent() + ' %</span>');
      h += mZeile("WASSERFALL-MODUS", "3D (3DSS), Normal (2D) oder Multi-Split",
        mWahl("wfmode", [["3d", "3D (3DSS)"], ["std", "2D NORMAL"], ["multi", "MULTI"]], SCOPE.mode));
      h += mZeile("WASSERFALL-RICHTUNG", "Fließrichtung der Zeitachse im Display",
        mWahl("wfdir", [["ab", "ABWÄRTS (0s oben)"], ["auf", "AUFWÄRTS (0s unten)"]], SCOPE.wfDown ? "ab" : "auf"));
      h += mZeile("WASSERFALL-PALETTE", "Farbschema in Gerät 1",
        mWahl("wfpal", [["ft710", "BLAU-ROT"], ["owrx", "OWRX"], ["feuer", "FEUER"], ["eis", "EIS"], ["gruen", "GRÜN"]], SCOPE.palette));
      h += mZeile("SUCHLAUF (SCAN)", "Ziel, Tempo &amp; Schwelle über Rauschsockel",
        mWahl("scanmodus", [["band", "BAND"], ["speicher", "SPEICHER"], ["ham", "HAM-BÄNDER"]], MENU_STAND.scanModus || "band") +
        mWahl("scantempo", [["schnell", "SCHNELL"], ["mittel", "MITTEL"], ["langsam", "LANGSAM"]], MENU_STAND.scanTempo || "mittel") +
        mWahl("scanschwelle", [[6, "+6 dB"], [10, "+10 dB"], [16, "+16 dB"]], MENU_STAND.scanSchwelle || 10) +
        ' <button class="fgm-knopf' + (SCAN_STATE.aktiv ? " an" : "") + '" data-tat="mscan">' + (SCAN_STATE.aktiv ? "SCAN STOP" : "SCAN START") + '</button>');
      h += mZeile("DUAL WATCH (DW)", "VFO-A &amp; VFO-B abwechselnd abhören",
        '<button class="fgm-knopf' + (DW_STATE.aktiv ? " an" : "") + '" data-tat="mdw">' + (DW_STATE.aktiv ? "DW AN" : "DW AUS") + '</button>');
    }

    if (r === "netz") {
      h += mZeile("BETRIEBSART DES GERÄTS", "",
        '<span class="fgm-hinweis">reines Empfangsgerät – Senden ist nicht möglich</span>');
      h += mZeile("SENDEN (TX)", "am Empfänger nicht verfügbar",
        '<span class="fgm-aus">gesperrt</span>');
      h += mZeile("LEISTUNG", "am Empfänger nicht verfügbar",
        '<span class="fgm-aus">gesperrt</span>');
      h += mZeile("NETZTEIL", "Spannung im Gerät",
        mWahl("netz", [[0, "13,8 V"], [1, "230 V"]], MENU_STAND.netz ? 1 : 0));
      h += mZeile("PTT-TASTE", "wurde entfernt – reines Hörgerät", "");
    }

    if (r === "anzeige") {
      h += mZeile("HELLIGKEIT", "Display und Beleuchtung",
        '<input type="range" class="fgm-schieber" data-set="hell" min="40" max="100" step="5" value="' + MENU_STAND.hell + '">' +
        '<span class="fgm-wert" data-feld="hellwert">' + MENU_STAND.hell + " %</span>");
      h += mZeile("LED-FELD", "RX · TX · ALC · PWR",
        mWahl("leds", [[0, "AUS"], [1, "AN"]], MENU_STAND.leds ? 1 : 0));
      h += mZeile("TASTENTON", "kurzes Quittieren", mWahl("ton", [[0, "AUS"], [1, "AN"]], MENU_STAND.ton ? 1 : 0));
      h += mZeile("UHR IM FUSS", "Ortszeit unten rechts", mWahl("zeit", [[0, "AUS"], [1, "AN"]], MENU_STAND.zeit ? 1 : 0));
      h += mZeile("TASTENBELEUCHTUNG GERÄT 1", "Farbe der Tasten am Funkgerät 1",
        mWahl("licht1", LICHT_FARBEN.map(function (f) { return [f.id, f.name]; }), lichtIdLesen(0)));
      h += mZeile("TASTENBELEUCHTUNG GERÄT 2", "Farbe der Tasten am Funkgerät 2",
        mWahl("licht2", LICHT_FARBEN.map(function (f) { return [f.id, f.name]; }), lichtIdLesen(1)));
      h += mZeile("TASTENBELEUCHTUNG GERÄT 3", "Farbe der Akzentbeleuchtung am Funkgerät 3",
        mWahl("licht3", LICHT_FARBEN.map(function (f) { return [f.id, f.name]; }), lichtIdLesen(2)));
    }

    if (r === "speicher") {
      h += '<div class="fgm-speicher">';
      h += '<div class="fgm-spzeile fgm-spkopf"><b>NAME</b><b>FREQUENZ</b><b>MODUS</b><b></b></div>';
      SPEICHER.forEach(function (sp, i) {
        h += '<div class="fgm-spzeile"><span>' + sp.n + '</span><span>' + hzKurz(sp.hz) +
             ' MHz</span><span>' + sp.m + '</span>' +
             '<button class="fgm-knopf" data-sp="' + i + '">abrufen</button></div>';
      });
      h += '</div>';
      h += mZeile("SPEICHERPLATZ", "eigene Frequenz merken",
        '<input type="text" class="fgm-such" data-feld="neuesp" placeholder="Name, z.B. Relais Nord" style="max-width:220px">' +
        '<button class="fgm-knopf" data-tat="spmerken">MERKEN</button>');
    }

    if (r === "profile") {
      h += '<div class="fgm-profil-kopf"><input type="text" class="fgm-such" data-feld="such" ' +
           'placeholder="Empfangsprofil suchen (Band, Ort, Frequenz)"></div>';
      h += '<div class="fgm-liste" data-feld="liste"></div>';
    }

    if (r === "geraet") {
      h += mZeile("GERÄT 1", "links · Funkgerät 1", "S-Meter-Bogen · Live-2D/3D-Wasserfall");
      h += mZeile("GERÄT 2", "rechts · Funkgerät 2", "Analog-S-Meter · Live-Bandscope & Drehregler");
      h += mZeile("GERÄT 3", "Touch-Konsole · Funkgerät 3", "Balken-S-Meter · Live-Spektrumscope & Dual-Regler");
      h += mZeile("VERDRAHTUNG", "alle drei am selben Empfänger",
        '<span class="fgm-hinweis">das zuletzt bediente Gerät stimmt ab</span>');
      h += mZeile("FASSUNG", "", FASSUNG);
      h += mZeile("ZURÜCKSETZEN", "Geräte auf Startwerte",
        '<button class="fgm-knopf" data-tat="reset">ZURÜCKSETZEN</button>');
    }

    var k = m.querySelector('[data-feld="koerper"]');
    k.innerHTML = h;
    menueBinden(m);

    if (r === "profile") {
      var li = m.querySelector('[data-feld="liste"]');
      if (li) {
        var su = m.querySelector('[data-feld="such"]');
        su.oninput = function () { menuProfileFuellen(li, su.value); };
        menuProfileFuellen(li, "");
      }
    }
  }

  function menueSqText() {
    return (MENU_STAND.squelch <= -149) ? "AUS" : (MENU_STAND.squelch + " dB");
  }

  function menuProfileFuellen(liste, such) {
    var jetzt = profilJetzt();
    var q = String(such || "").toLowerCase().trim();
    var html = "", treffer = 0;
    profilGruppen().forEach(function (gr) {
      var pass = gr.eintraege.filter(function (e) {
        if (!q) { return /ham_/i.test(e.wert) || /\bHAM\b/i.test(e.text); }
        return (e.text + " " + e.wert).toLowerCase().indexOf(q) >= 0;
      }).slice(0, q ? 80 : 40);
      if (!pass.length) { return; }
      treffer += pass.length;
      html += '<div class="fgm-gruppe"><div class="fgm-gtitel">' + gr.titel + '</div><div class="fgm-gitter">';
      pass.forEach(function (e) {
        var an = (jetzt && jetzt.wert === e.wert) ? " an" : "";
        html += '<button class="fgm-eintrag' + an + '" data-wert="' + e.wert.replace(/"/g, "&quot;") + '">' + e.kurz + '</button>';
      });
      html += '</div></div>';
    });
    liste.innerHTML = treffer ? html : '<div class="fgm-leer">Kein Profil gefunden.</div>';
    Array.prototype.forEach.call(liste.querySelectorAll(".fgm-eintrag"), function (b) {
      b.onclick = function () {
        if (profilWechseln(b.dataset.wert)) { menuFuellen(); }
      };
    });
  }

  function menueBinden(m) {
    /* Umschalter */
    Array.prototype.forEach.call(m.querySelectorAll("[data-set]"), function (el) {
      var satz = el.dataset.set;
      if (el.type === "range") {
        el.oninput = function () {
          var v = parseInt(el.value, 10);
          var w = m.querySelector('[data-feld="sqwert"]');
          if (satz === "squelch") {
            MENU_STAND.squelch = v;
            if (w) { w.textContent = menueSqText(); }
            squelchSetzen(v);
            reglerSyncAlle();
          }
          if (satz === "rf") {
            if (_rfState.darfAendern === false) {
              if (typeof _rfState.serverWert === "number") { el.value = String(Math.round(_rfState.serverWert)); }
              rfAnwenden(v);
              return;
            }
            MENU_STAND.rf = v;
            var rf = m.querySelector('[data-feld="rfwert"]');
            if (rf) { rf.textContent = v + " dB"; }
            rfAnwenden(v);
            reglerSyncAlle();
          }
          if (satz === "vol") {
            var nv = volSetzen(v);
            var vw = m.querySelector('[data-feld="volwert"]');
            if (vw) { vw.textContent = nv + " %"; }
            if (FENSTER[0]) { ftTelemetrieSync(FENSTER[0]); }
            if (FENSTER[1]) { tsTelemetrieSync(FENSTER[1]); }
            if (FENSTER[2]) { icTelemetrieSync(FENSTER[2]); }
          }
          if (satz === "hell") {
            MENU_STAND.hell = v;
            var hw = m.querySelector('[data-feld="hellwert"]');
            if (hw) { hw.textContent = v + " %"; }
            helligkeitSetzen(v);
          }
          menuStandSichern();
        };
        return;
      }
      el.onclick = function () {
        var w = el.dataset.wert;
        if (satz === "modus") {
          Z.geraete.forEach(function (gg) { gg.modus = w; });
          empfangenModus(w); zeichnen();
        }
        if (satz === "filt") { MENU_STAND.filt = parseInt(w, 10); }
        if (satz === "agc") { MENU_STAND.agc = w; }
        if (satz === "nr") { MENU_STAND.nr = parseInt(w, 10); nrSetzen(MENU_STAND.nr); afSet("NR", MENU_STAND.nr > 0); }
        if (satz === "nb") { MENU_STAND.nb = (w === "1"); afSet("NB", MENU_STAND.nb); }
        if (satz === "att") { MENU_STAND.att = parseInt(w, 10); }
        if (satz === "pre") { MENU_STAND.pre = (w === "1"); }
        if (satz === "netz") { MENU_STAND.netz = (w === "1"); }
        if (satz === "leds") { MENU_STAND.leds = (w === "1"); ledFeldZeigen(MENU_STAND.leds); }
        if (satz === "ton") { MENU_STAND.ton = (w === "1"); }
        if (satz === "zeit") { MENU_STAND.zeit = (w === "1"); }
        if (satz === "hamband") {
          var hb = BAENDER.filter(function (x) { return x.n === w; })[0];
          if (hb) { bandWaehlen(Z.aktiv || 0, hb); }
        }
        if (satz === "licht1") { lichtAnwenden(w, 0); }
        if (satz === "licht2") { lichtAnwenden(w, 1); }
        if (satz === "licht3") { lichtAnwenden(w, 2); }
        if (satz === "wfmode") { if (w === "multi") { SCOPE.mode = "multi"; scopeCfgSichern(); } else { dnx3dModusSetzen(w); } if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); } }
        if (satz === "wfdir") { SCOPE.wfDown = (w !== "auf"); scopeCfgSichern(); if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); } if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); } if (FENSTER[2]) { scopeZeichnen(2, FENSTER[2], true); } }
        if (satz === "wfpal") { SCOPE.palette = w; scopeCfgSichern(); if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); } if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); } if (FENSTER[2]) { scopeZeichnen(2, FENSTER[2], true); } }
        if (satz === "scanmodus") { MENU_STAND.scanModus = w; }
        if (satz === "scantempo") { MENU_STAND.scanTempo = w; }
        if (satz === "scanschwelle") { MENU_STAND.scanSchwelle = parseInt(w, 10) || 10; }
        menuStandSichern();
        menuFuellen();
      };
    });
    /* Speicher abrufen */
    Array.prototype.forEach.call(m.querySelectorAll("[data-sp]"), function (b) {
      b.onclick = function () {
        var i = parseInt(b.dataset.sp, 10);
        var sp = SPEICHER[i];
        if (sp) { abstimmen(Z.aktiv, sp.hz, sp.m, sp.n); menuZeigen(false); }
      };
    });
    var sm = m.querySelector('[data-tat="spmerken"]');
    if (sm) {
      sm.onclick = function () {
        var feld = m.querySelector('[data-feld="neuesp"]');
        var g2 = Z.geraete[Z.aktiv];
        var nm = (feld && feld.value.trim()) || ("Eigener " + (MENU_STAND.speicher.length + 1));
        SPEICHER.push({ n: nm, hz: g2.hz, m: g2.modus });
        if (feld) { feld.value = ""; }
        menuFuellen();
      };
    }
    var msc = m.querySelector('[data-tat="mscan"]');
    if (msc) { msc.onclick = function () { scanToggle(Z.aktiv || 0); menuFuellen(); }; }
    var mdw = m.querySelector('[data-tat="mdw"]');
    if (mdw) { mdw.onclick = function () { dwToggle(Z.aktiv || 0); menuFuellen(); }; }
    var rs = m.querySelector('[data-tat="reset"]');
    if (rs) {
      rs.onclick = function () {
        try { localStorage.removeItem("dnx.fg.zustand3"); localStorage.removeItem("dnx.fg.menu"); } catch (e) { }
        location.reload();
      };
    }
  }

  /* Squelch wirklich stellen (der Regler im Empfänger-Panel) */
  function squelchSetzen(db) {
    try {
      var s = document.querySelector(".openwebrx-squelch-slider");
      if (!s) { return false; }
      s.value = String(db);
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) { return false; }
  }
  function nrSetzen(stufe) {
    try {
      if (typeof UI !== "undefined" && typeof UI.setNR === "function") { UI.setNR(stufe); return true; }
    } catch (e) { }
    return false;
  }
  function helligkeitSetzen(prozent) {
    try {
      document.documentElement.style.setProperty("--dnx-fg-hell", (prozent / 100));
      FENSTER.forEach(function (w) {
        if (!w) { return; }
        w.style.filter = "brightness(" + (0.55 + prozent / 145) + ")";
      });
    } catch (e) { }
  }
  function ledFeldZeigen(an) {
    FENSTER.forEach(function (w) {
      if (!w) { return; }
      var f = w.querySelector(".w1-leds, .w2-leds");
      if (f) { f.style.display = an ? "" : "none"; }
    });
  }

  /* ================= Aussehen (aus der Vorlagendatei uebernommen) ====== */
  var CSS = [
    /* --- gemeinsames Fenster --- */
    ".fgw{position:fixed;z-index:2147483645;box-sizing:border-box;user-select:none}",
    
    ".fgw *{box-sizing:border-box}",
    /* [SCHLIESSEN WIE AUF 111] 20.11.2026: Auf 111 sitzt der Schliessen-Knopf
       mittig ueber dem Geraet (.g2-zu: left 50%, top 5px, 24x24 rund).
       Hier war er klein in der Ecke und wurde nie eingebaut - deshalb fehlte er. */

    /* ---- Gemeinsame Resize-Ecken & Wechselschalter (111-Paritaet) ---- */
    ".fg-eck{position:absolute;width:20px;height:20px;z-index:30;opacity:.48;transition:opacity .14s,filter .14s}",
    ".fgw:hover .fg-eck{opacity:.82}",
    ".fg-eck:hover{opacity:1 !important;filter:drop-shadow(0 0 6px var(--w1-licht,var(--w2-licht,#4f94ff)))}",
    ".fg-eck.tl{top:-2px;left:-2px;cursor:nwse-resize;border-top:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-left:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-radius:4px 0 0 0}",
    ".fg-eck.tr{top:-2px;right:-2px;cursor:nesw-resize;border-top:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-right:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-radius:0 4px 0 0}",
    ".fg-eck.bl{bottom:-2px;left:-2px;cursor:nesw-resize;border-bottom:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-left:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-radius:0 0 0 4px}",
    ".fg-eck.br{bottom:-2px;right:-2px;cursor:nwse-resize;border-bottom:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-right:2.5px solid var(--w1-licht,var(--w2-licht,#4f94ff));border-radius:0 0 4px 0}",
    ".fg-wechsel{position:absolute;top:-21px;right:24px;height:20px;padding:0 7px;border-radius:10px;z-index:28;",
    "display:flex;align-items:center;justify-content:center;cursor:pointer;font:800 10.5px/1 ui-monospace,monospace;",
    "color:#e2e8f0;background:rgba(16,22,30,.92);border:1px solid rgba(148,197,255,.45);box-shadow:0 2px 6px rgba(0,0,0,.6);transition:background .12s,border-color .12s,color .12s}",
    ".fg-wechsel:hover{background:rgba(var(--w1-licht-rgb,var(--w2-licht-rgb,79,148,255)),.38);border-color:var(--w1-licht,var(--w2-licht,#4f94ff));color:#fff}",
    ".fg-zu{position:absolute;top:-22px;left:50%;margin-left:-11px;width:22px;height:22px;border-radius:50%;z-index:29;",
    "display:flex;align-items:center;justify-content:center;cursor:pointer;font:700 15px/1 system-ui;",
    "color:#f1f5f9;background:rgba(16,22,28,.94);border:1.5px solid rgba(203,213,225,.58);box-shadow:0 2px 8px rgba(0,0,0,.7);transition:background .12s,color .12s,border-color .12s}",
    ".fg-zu:hover{color:#fff;background:#dc2626;border-color:#fca5a5}",
    ".fgw.fg-oben-eng .fg-wechsel{top:3px !important;right:48px !important}",
    ".fgw.fg-oben-eng .fg-zu{top:3px !important;left:auto !important;right:20px !important;margin-left:0 !important}",

    /* ---- Geraet 1: v8.10 Straight-On Frontal-Konsole OHNE Lautsprecher ---- */
    ".fg-w1{width:800px;--w1-licht:#4f94ff;--w1-leg:#e2eeff;--w1-licht-rgb:79,148,255}",
    ".ft-shell{position:relative;width:800px;height:313.78px;user-select:none}",
    ".ft-stage{position:relative;width:800px;height:313.78px;transform-origin:top left}",
    ".ft-chassis{position:relative;width:100%;height:100%;cursor:grab;filter:drop-shadow(0 16px 30px rgba(0,0,0,.85))}",
    ".ft-chassis:active{cursor:grabbing}",
    ".ft-photo{display:block;width:100%;height:100%;pointer-events:none;border-radius:4px}",
    ".ft-photo-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}",

    /* Oberkanten-Leiste auf dem Deckel: VOL · SQ · RF + direkte HAM-Band-Knoepfe */
    ".ft-lid-bar{position:absolute;z-index:13;display:flex;align-items:center;justify-content:space-between;gap:3.5px;padding:1px 3px;",
    "background:linear-gradient(180deg,rgba(16,20,27,.95),rgba(9,12,17,.98));border:1px solid rgba(148,163,184,.22);",
    "border-radius:3px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 2px 4px rgba(0,0,0,.72)}",
    ".ft-lid-telem{display:flex;align-items:center;gap:2.5px;flex:0 0 auto}",
    ".ft-tpill{height:13.5px;padding:0 4.5px;border-radius:2px;border:1px solid rgba(71,85,105,.55);",
    "background:linear-gradient(180deg,#252b35,#151921);color:#e2e8f0;font:800 7.5px/1 ui-monospace,monospace;letter-spacing:.1px;",
    "cursor:ns-resize;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;",
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 1px 2px rgba(0,0,0,.55)}",
    ".ft-tpill:hover{border-color:rgba(var(--w1-licht-rgb),.65);color:#fff}",
    ".ft-tpill.an{background:linear-gradient(180deg,#2a3240,#181e28);border-color:rgba(var(--w1-licht-rgb),.65);color:#fff;box-shadow:inset 0 -2px 0 var(--w1-licht),0 0 6px rgba(var(--w1-licht-rgb),.38)}",
    ".ft-lid-ham{display:flex;align-items:center;gap:2px;flex:1;justify-content:space-between;min-width:0;overflow:hidden}",
    ".ft-hambtn{height:13.5px;padding:0 2.5px;border-radius:2px;border:1px solid rgba(71,85,105,.5);",
    "background:linear-gradient(180deg,#242a34,#141820);color:#d1d5db;font:800 7.4px/1 ui-monospace,monospace;",
    "cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;flex:1 1 auto;",
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 1px 2px rgba(0,0,0,.55)}",
    ".ft-hambtn:hover{border-color:rgba(var(--w1-licht-rgb),.65);color:#fff;background:linear-gradient(180deg,#2d3748,#1a2230)}",
    ".ft-hambtn.an{background:linear-gradient(180deg,#263042,#161d29);border-color:rgba(var(--w1-licht-rgb),.75);color:#fff;text-shadow:0 0 5px rgba(var(--w1-licht-rgb),.8);box-shadow:inset 0 -2px 0 var(--w1-licht),0 0 7px rgba(var(--w1-licht-rgb),.45)}",
    ".ft-ham-more{background:linear-gradient(180deg,#2b3545,#171e29);border-color:rgba(148,163,184,.48);color:#e2e8f0;padding:0 4px}",

    /* Obere Display-Blende (markenfrei retuschierte Zeile): COLOR · DW · SCAN · WF OPT · BAND · MENÜ */
    ".ft-top-bar{position:absolute;z-index:12;display:flex;align-items:center;gap:2.5px;padding:1px 3px;",
    "background:linear-gradient(180deg,rgba(14,17,23,.96),rgba(8,10,15,.99));border:1px solid rgba(100,116,139,.26);",
    "border-radius:3px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}",
    ".ft-bar-btn{height:13.5px;padding:0 4.5px;border-radius:2px;border:1px solid rgba(71,85,105,.52);",
    "background:linear-gradient(180deg,#252c38,#151921);color:#e2e8f0;font:800 7.6px/1 system-ui;letter-spacing:.25px;",
    "cursor:pointer;display:inline-flex;align-items:center;gap:2.5px;white-space:nowrap;",
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 1px 2px rgba(0,0,0,.55)}",
    ".ft-bar-btn:hover{border-color:rgba(var(--w1-licht-rgb),.65);color:#fff}",
    ".ft-bar-btn.an{background:linear-gradient(180deg,#273142,#161d28);border-color:rgba(var(--w1-licht-rgb),.75);color:#fff;text-shadow:0 0 5px rgba(var(--w1-licht-rgb),.8);box-shadow:inset 0 -2px 0 var(--w1-licht),0 0 7px rgba(var(--w1-licht-rgb),.45)}",
    ".ft-bar-btn i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#4f94ff;border:1px solid rgba(255,255,255,.55)}",
    ".ft-bar-btn em{font:700 7.2px/1 ui-monospace,monospace;font-style:normal;color:#cbd5e1}",
    ".ft-bar-menu{margin-left:auto;padding:0 6px;font-size:9px}",

    /* TFT-Echtglas (246x149 Source px) */
    ".ft-screen-slot{position:absolute;z-index:10;overflow:hidden;border-radius:3px;padding:3px 4px 2px;",
    "background:linear-gradient(180deg,#0e1e3a 0%,#081326 60%,#050b18 100%);",
    "box-shadow:inset 0 0 0 1px rgba(148,197,255,.22),inset 0 0 22px rgba(var(--w1-licht-rgb),.16);",
    "display:flex;flex-direction:column;gap:1.5px;transition:filter .16s}",
    ".ft-screen-slot.dim{filter:brightness(.36) saturate(.7)}",
    ".ft-scr-top{display:grid;grid-template-columns:152px 1fr;gap:4px;align-items:start}",
    ".ft-sm-wrap{display:flex;flex-direction:column;width:152px}",
    ".ft-sm-arc{position:relative;width:152px;height:50px;overflow:hidden}",
    ".ft-sm-arc i{position:absolute;display:block;width:1.3px;background:#64748b;transform-origin:50% 0}",
    ".ft-sm-arc i.h{width:1.7px;background:#94a3b8}",
    ".ft-sm-arc i.an{background:#fff}",
    ".ft-sm-arc i.an.w{background:#60a5fa}",
    ".ft-sm-arc i.an.r{background:#ef4444}",
    ".ft-sm-arc span{position:absolute;transform:translate(-50%,-50%);font:800 italic 8.8px/1 ui-monospace,monospace;color:#f8fafc;pointer-events:none;text-shadow:0 1px 2px #000}",
    ".ft-sm-arc span.kl{font-size:7.6px;color:#93c5fd}",
    ".w1-nadel{background:linear-gradient(180deg,#ff4d43 0%,#ef4444 48%,transparent 65%);box-shadow:0 0 5px rgba(255,70,58,.9)}",
    ".ft-db-row{display:flex;align-items:center;justify-content:space-between;padding:0 2px;margin-top:0}",
    ".ft-db-txt{font:800 9.0px/1 ui-monospace,monospace;color:#dbeafe}",
    ".ft-ind-tags{display:flex;gap:2.5px}",
    ".ft-ind-tags i{font:800 7.4px/1 system-ui;font-style:normal;padding:1.5px 3px;border-radius:1.5px;background:rgba(15,23,42,.78);color:#64748b;border:1px solid rgba(71,85,105,.45)}",
    ".ft-ind-tags i.an{background:rgba(var(--w1-licht-rgb),.34);color:#fff;border-color:var(--w1-licht);box-shadow:0 0 5px rgba(var(--w1-licht-rgb),.55)}",

    ".ft-vfo-col{display:flex;flex-direction:column;gap:2px;min-width:0;padding-top:1px}",
    ".ft-vfoa-row,.ft-vfob-row{display:flex;align-items:center;gap:2.5px;min-width:0}",
    ".ft-vfo-badge{display:flex;flex-direction:column;gap:1px;flex:0 0 27px}",
    ".ft-vfo-tag{font:800 italic 6.8px/1 system-ui;color:#94a3b8;text-align:center}",
    ".ft-vfo-tag.aktiv{color:#fff;text-shadow:0 0 5px rgba(var(--w1-licht-rgb),.85)}",
    ".ft-mode-btn{background:linear-gradient(180deg,#2563eb,#1d4ed8);border:none;border-radius:2px;color:#fff;font:800 7.5px/1.15 system-ui;padding:1.5px 2px;cursor:pointer}",
    ".ft-freq{flex:1;background:transparent;border:none;padding:0;margin:0;text-align:right;cursor:pointer;",
    "font:800 italic 11.4px/1 ui-monospace,'SF Mono',Consolas,monospace;color:#fff;white-space:nowrap;text-shadow:0 0 9px rgba(186,230,253,.45)}",
    ".ft-freq:hover{color:#bae6fd}",
    ".ft-freq small{font-size:6.5px;color:#93c5fd;margin-left:1.5px;font-weight:700;font-style:normal}",
    ".ft-submode{background:#7f1d1d;border:1px solid #b91c1c;color:#fecaca;border-radius:2px;font:700 6.8px/1.1 system-ui;text-align:center;padding:1px}",
    ".ft-subb{flex:1;background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:800 italic 8.8px/1 ui-monospace,monospace;color:#dbeafe;white-space:nowrap}",
    ".ft-subb small{display:none}",
    ".ft-level-btn{background:linear-gradient(180deg,#1a335c,#102242);border:1px solid #60a5fa;color:#dbeafe;border-radius:2px;font:800 7.4px/1 system-ui;padding:2.5px 4.5px;cursor:pointer}",
    ".ft-level-btn:hover{background:#1d4ed8;color:#fff}",

    ".ft-scr-info{display:grid;grid-template-columns:repeat(4,38px) 1fr;min-height:23.5px;border-top:1px solid rgba(96,165,250,.32);border-bottom:1px solid rgba(96,165,250,.32);background:rgba(12,24,48,.78)}",
    ".ft-icell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:1.5px 1px;border:none;border-right:1px solid rgba(96,165,250,.28);background:linear-gradient(180deg,rgba(24,42,76,.9),rgba(11,22,42,.95));box-shadow:inset 0 1px 0 rgba(255,255,255,.08);cursor:pointer}",
    ".ft-icell:hover{background:linear-gradient(180deg,rgba(37,78,148,.92),rgba(19,44,88,.96))}",
    ".ft-icell.an{background:linear-gradient(180deg,rgba(32,64,122,.96),rgba(16,35,72,.98));box-shadow:inset 0 -2px 0 var(--w1-licht),inset 0 1px 0 rgba(255,255,255,.12)}",
    ".ft-icell b{font:800 7.5px/1.05 system-ui;color:#fca5a5;letter-spacing:.2px}",
    ".ft-icell span{font:800 9.3px/1.1 ui-monospace,monospace;color:#ffffff}",
    ".ft-pb-wrap{display:flex;flex-direction:column;justify-content:center;gap:1px;padding:1px 3px;min-width:0}",
    ".ft-pb-svg{width:100%;height:9.5px;display:block}",
    ".ft-scope-info{background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:700 7.2px/1 ui-monospace,monospace;color:#93c5fd;white-space:nowrap}",
    ".ft-scope-info b{color:#fff}",
    ".ft-scope-info:hover{color:#fff}",

    ".ft-scr-scope{position:relative;flex:1;min-height:42px;display:flex;flex-direction:column;background:#040914;border:1px solid rgba(59,130,246,.3);border-radius:2px;overflow:hidden}",
    ".ft-scr-scope.expand{min-height:58px}",
    ".ft-scope-cv{width:100%;flex:1;min-height:30px;display:block;cursor:crosshair}",
    ".ft-scope-axis{display:flex;justify-content:space-between;padding:1px 3px;background:#071022;font:700 6.8px/1 ui-monospace,monospace;color:#94a3b8}",
    ".ft-scope-axis .mid{color:#f8fafc;font-weight:800}",

    ".ft-scr-meta{display:flex;justify-content:space-between;align-items:center;gap:4px;padding:0 2px;font:700 7.2px/1.1 ui-monospace,monospace;color:#93c5fd;white-space:nowrap}",
    ".ft-status-msg{color:#fde047;font-weight:800;overflow:hidden;text-overflow:ellipsis;max-width:54%}",

    ".ft-softkeys{display:grid;grid-template-columns:repeat(6,1fr);gap:2.5px}",
    ".ft-softkeys button{height:16.5px;border-radius:2px;border:1px solid rgba(100,116,139,.42);background:linear-gradient(180deg,#232b3a,#121722);color:#e2e8f0;font:800 8.2px/1 system-ui;letter-spacing:.25px;cursor:pointer;padding:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)}",
    ".ft-softkeys button:hover{border-color:rgba(var(--w1-licht-rgb),.7);color:#fff}",
    ".ft-softkeys button.an{background:linear-gradient(180deg,#28354c,#151e2e);border-color:rgba(var(--w1-licht-rgb),.8);color:#fff;text-shadow:0 0 5px rgba(var(--w1-licht-rgb),.8);box-shadow:inset 0 -2px 0 var(--w1-licht),0 0 7px rgba(var(--w1-licht-rgb),.42)}",

    /* Inline TFT Popovers */
    ".ft-pop{display:none;position:absolute;inset:2px;z-index:20;background:rgba(6,13,28,.97);border:1px solid var(--w1-licht);border-radius:3px;padding:4px 5px;flex-direction:column;gap:3px;box-shadow:0 0 18px rgba(0,0,0,.9)}",
    ".ft-pop.offen{display:flex}",
    ".ft-pop-hd{display:flex;justify-content:space-between;align-items:center;font:800 8px/1 system-ui;letter-spacing:.4px;color:#93c5fd;border-bottom:1px solid rgba(148,163,184,.25);padding-bottom:2px}",
    ".ft-pop-hd button{background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:2px;width:15px;height:15px;line-height:1;cursor:pointer;font-weight:800;padding:0}",
    ".ft-pop-grid{display:grid;gap:2.5px;flex:1;align-content:start}",
    ".ft-pop-grid.g5{grid-template-columns:repeat(5,1fr)}",
    ".ft-pop-grid.g4{grid-template-columns:repeat(4,1fr)}",
    ".ft-pop-grid.g3{grid-template-columns:repeat(3,1fr)}",
    ".ft-pop-grid button,.ft-wf-grp button,.ft-lvl-btns button{padding:3.5px 2px;border-radius:2px;border:1px solid #334155;background:#162238;color:#e2e8f0;font:700 7.5px/1 system-ui;cursor:pointer}",
    ".ft-pop-grid button.an,.ft-wf-grp button.an,.ft-lvl-btns button.an{background:rgba(var(--w1-licht-rgb),.38);border-color:var(--w1-licht);color:#fff}",
    ".ft-pop-allprof{padding:3.5px 5px;border-radius:2px;border:1px solid #475569;background:#0f2340;color:#bae6fd;font:800 7.5px/1 system-ui;cursor:pointer;text-align:center}",
    ".ft-pop-allprof:hover{border-color:var(--w1-licht);color:#fff}",
    ".ft-pop-list{display:flex;flex-direction:column;gap:2.5px;overflow:auto}",
    ".ft-pop-list button{display:flex;justify-content:space-between;padding:4px 5px;border-radius:2px;border:1px solid #334155;background:#132036;color:#e2e8f0;font:700 8px/1 ui-monospace,monospace;cursor:pointer}",
    ".ft-pop-list button:hover{border-color:var(--w1-licht)}",

    ".ft-lvl-grid{display:flex;flex-direction:column;gap:4px;flex:1}",
    ".ft-lvl-row{display:grid;grid-template-columns:28px 1fr 42px;align-items:center;gap:4px;font:800 8px/1 ui-monospace,monospace;color:#e2e8f0}",
    ".ft-lvl-row input{width:100%;accent-color:var(--w1-licht);margin:0;height:12px}",
    ".ft-lvl-row em{font-style:normal;text-align:right;color:#93c5fd}",
    ".ft-lvl-btns{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;margin-top:auto}",

    ".ft-wf-opts{display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;justify-content:space-between}",
    ".ft-wf-grp{display:flex;flex-direction:column;gap:1px}",
    ".ft-wf-grp b{font:800 6.2px/1 system-ui;color:#93c5fd;letter-spacing:.3px}",
    ".ft-wf-grp div{display:flex;flex-wrap:wrap;gap:2px}",
    ".ft-wf-grp button{padding:2px 4px;font-size:6.8px}",

    ".ft-pad-disp{display:flex;justify-content:space-between;align-items:center;background:#0a152a;border:1px solid #334155;border-radius:2px;padding:3px 5px;font:800 11px/1 ui-monospace,monospace;color:#fff}",
    ".ft-pad-disp small{font-size:7.5px;color:#93c5fd}",
    ".ft-pad-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5px;flex:1}",
    ".ft-pad-grid button{border-radius:2px;border:1px solid #334155;background:#162238;color:#fff;font:800 9.5px/1 ui-monospace,monospace;cursor:pointer;padding:3px 0}",
    ".ft-pad-grid .ft-pad-clr{background:#451a1a;border-color:#7f1d1d}",
    ".ft-pad-grid .ft-pad-ent{grid-column:span 3;background:linear-gradient(180deg,#2563eb,#1d4ed8);border-color:#60a5fa;font:800 8.5px/1 system-ui;padding:4px 0}",

    /* Realistische Hardware-Tasten-Beleuchtung ohne blaue Kastenrahmen */
    ".ft-spot{position:absolute;z-index:8;background:transparent;border:none;border-radius:2px;cursor:pointer;padding:0;transition:background .12s,box-shadow .12s;overflow:visible}",
    ".ft-spot-key::after{content:'';position:absolute;left:26%;right:26%;bottom:2.2px;height:1.8px;border-radius:1px;opacity:0;transition:opacity .12s;pointer-events:none}",
    ".fg-w1.ft-lit .ft-spot-key{box-shadow:inset 0 0 4px rgba(var(--w1-licht-rgb),.10)}",
    ".ft-spot-key:hover{background:radial-gradient(ellipse at 50% 50%,rgba(var(--w1-licht-rgb),.24) 0%,rgba(var(--w1-licht-rgb),0) 76%)}",
    ".ft-spot-key.an{background:radial-gradient(ellipse at 50% 56%,rgba(var(--w1-licht-rgb),.32) 0%,rgba(var(--w1-licht-rgb),.07) 64%,rgba(var(--w1-licht-rgb),0) 86%)}",
    ".ft-spot-key.an::after{opacity:1;background:var(--w1-licht);box-shadow:0 0 6px var(--w1-licht),0 0 2px #fff}",
    ".ft-spot-dnr{border-bottom-right-radius:10px}",
    ".ft-spot-nar{border-bottom-left-radius:10px}",
    ".ft-spot-jack{border-radius:8px}",
    ".ft-spot-jack:hover{background:radial-gradient(circle at 50% 50%,rgba(var(--w1-licht-rgb),.20) 0%,rgba(var(--w1-licht-rgb),0) 74%)}",

    /* Drehknopfe auf dem Originalfoto */
    ".ft-knob{position:absolute;z-index:9;border-radius:50%;cursor:ns-resize;display:flex;align-items:center;justify-content:center}",
    ".ft-knob-cv{width:100%;height:100%;display:block;pointer-events:none}",
    ".ft-knob-tag{position:absolute;bottom:-5px;right:-3px;background:rgba(10,14,22,.92);border:1px solid rgba(148,163,184,.5);color:#e2e8f0;font:800 6.5px/1 ui-monospace,monospace;padding:1px 2.5px;border-radius:2px;pointer-events:none}",
    ".ft-vfo-knob{cursor:grab}",
    ".ft-vfo-knob:active{cursor:grabbing}",

    /* ---- Geraet 2: Kenwood TS-890S Straight-On Fotokonsole (766x299.7 px) ---- */
    ".fg-w2{width:766px;--w2-licht:#22d3ee;--w2-leg:#d8f8ff;--w2-licht-rgb:34,211,238}",
    ".ts-shell{position:relative;width:766px;height:299.73px;user-select:none}",
    ".ts-stage{position:relative;width:766px;height:299.73px;transform-origin:top left}",
    ".ts-chassis{position:relative;width:100%;height:100%;cursor:grab;filter:drop-shadow(0 16px 30px rgba(0,0,0,.85))}",
    ".ts-chassis:active{cursor:grabbing}",
    ".ts-photo{display:block;width:100%;height:100%;pointer-events:none;border-radius:4px}",
    ".ts-photo-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4}",

    /* Schlanke Top-Bezel-Leiste (zwischen KENWOOD & BUSY/TX) */
    ".ts-lid-bar{position:absolute;z-index:13;display:flex;align-items:center;gap:2.2px;padding:1px 2.5px;",
    "background:linear-gradient(180deg,rgba(15,19,25,.95),rgba(9,12,17,.98));border:1px solid rgba(148,163,184,.24);",
    "border-radius:2.5px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 2px 4px rgba(0,0,0,.72)}",
    ".ts-tpill,.ts-tbtn{height:12.5px;padding:0 3.5px;border-radius:2px;border:1px solid rgba(71,85,105,.52);",
    "background:linear-gradient(180deg,#242a34,#141820);color:#e2e8f0;font:800 7.0px/1 ui-monospace,monospace;letter-spacing:0;",
    "cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:2px;",
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 1px 2px rgba(0,0,0,.55)}",
    ".ts-tpill{cursor:ns-resize}",
    ".ts-tpill:hover,.ts-tbtn:hover{border-color:rgba(var(--w2-licht-rgb),.7);color:#fff}",
    ".ts-tpill.an,.ts-tbtn.an{background:linear-gradient(180deg,#263042,#161d29);border-color:rgba(var(--w2-licht-rgb),.78);color:#fff;box-shadow:inset 0 -2px 0 var(--w2-licht),0 0 6px rgba(var(--w2-licht-rgb),.42)}",
    ".ts-tbtn i{display:inline-block;width:5.5px;height:5.5px;border-radius:50%;background:#22d3ee;border:1px solid rgba(255,255,255,.5)}",
    ".ts-tbtn em{font:700 6.8px/1 ui-monospace,monospace;font-style:normal;color:#cbd5e1}",
    ".ts-tmenu{margin-left:auto;padding:0 5px;font-size:8.5px}",

    /* Kenwood 7"-TFT Echtglas (284.4x169.1 px) */
    ".ts-screen-slot{position:absolute;z-index:10;overflow:hidden;border-radius:2.5px;padding:2px 26px 2px 3px;",
    "background:linear-gradient(180deg,#0c182c 0%,#071020 62%,#040914 100%);",
    "box-shadow:inset 0 0 0 1px rgba(148,197,255,.22),inset 0 0 22px rgba(var(--w2-licht-rgb),.14);",
    "display:flex;flex-direction:column;gap:1.5px;transition:filter .16s}",
    ".ts-screen-slot.dim{filter:brightness(.36) saturate(.7)}",

    ".ts-scr-hd{display:flex;align-items:center;gap:2px;height:11px;flex:0 0 auto}",
    ".ts-hd-tag{height:10.5px;padding:0 2.5px;border-radius:1.5px;border:1px solid rgba(96,165,250,.32);background:rgba(16,32,58,.9);color:#93c5fd;font:800 6.4px/1 ui-monospace,monospace;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:1.5px}",
    ".ts-hd-tag em{font-style:normal;color:#fff}",
    ".ts-hd-tag.an{border-color:var(--w2-licht);background:rgba(var(--w2-licht-rgb),.28)}",
    ".ts-ind-tags{display:flex;gap:1.5px;margin-left:auto}",
    ".ts-ind-tags i{font:800 6.2px/1 system-ui;font-style:normal;padding:1.5px 2px;border-radius:1.5px;background:rgba(15,23,42,.75);color:#64748b;border:1px solid rgba(71,85,105,.4)}",
    ".ts-ind-tags i.an{background:rgba(var(--w2-licht-rgb),.34);color:#fff;border-color:var(--w2-licht)}",
    ".ts-lvl-btn{height:10.5px;padding:0 3.5px;border-radius:1.5px;border:1px solid #60a5fa;background:linear-gradient(180deg,#1a335c,#102242);color:#dbeafe;font:800 6.5px/1 system-ui;cursor:pointer}",
    ".ts-lvl-btn:hover{background:#1d4ed8;color:#fff}",

    ".ts-scr-top{display:grid;grid-template-columns:128px 1fr;gap:4px;align-items:stretch;height:48px;flex:0 0 auto}",
    ".ts-meter-wrap{position:relative;width:128px;height:48px;overflow:hidden;border-radius:2.5px;",
    "background-color:#f4e0ad !important;background:radial-gradient(ellipse at 50% 88%,#fffbe4 0%,#f4e0ad 58%,#cbb483 100%) !important;border:1.5px solid #475569;",
    "box-shadow:inset 0 2px 5px rgba(0,0,0,.45),inset 0 0 12px rgba(255,235,165,.9)}",
    ".ts-meter-wrap::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:4;background:linear-gradient(128deg,rgba(255,255,255,.34) 0%,rgba(255,255,255,.06) 32%,transparent 35%)}",
    ".ts-meter{position:relative;width:128px;height:48px}",
    ".w2-nadel{background:linear-gradient(180deg,#dc2626 0%,#b91c1c 55%,transparent 75%);box-shadow:0 0 2px rgba(0,0,0,.45);transition:transform .06s linear}",
    ".w2-meter-hub{position:absolute;left:50%;bottom:-6px;width:13px;height:11px;border-radius:50%;transform:translateX(-50%);background:radial-gradient(circle at 40% 30%,#4b5563,#111827);border:1px solid #374151;z-index:4}",
    ".ts-meter-pk{position:absolute;right:4px;top:3px;width:4.5px;height:4.5px;border-radius:50%;z-index:5;background:#451a1a;border:1px solid rgba(0,0,0,.45)}",
    ".ts-meter-pk.an{background:radial-gradient(circle at 35% 35%,#ffe4e6,#ff2a2a 60%,#991b1b);box-shadow:0 0 7px #ff2a2a}",
    ".ts-db-pill{position:absolute;left:2px;bottom:1px;z-index:5;padding:0.5px 3px;border-radius:1.5px;background:rgba(15,23,42,.82);color:#fde68a;font:800 6.5px/1.1 ui-monospace,monospace}",

    ".ts-vfo-col{display:flex;flex-direction:column;justify-content:space-between;min-width:0}",
    ".ts-vfoa-row,.ts-vfob-row{display:flex;align-items:center;gap:2.5px;min-width:0}",
    ".ts-mode-badge{background:linear-gradient(180deg,#0284c7,#0369a1);border:none;border-radius:2px;color:#fff;font:800 7.0px/1.1 system-ui;padding:1.5px 3px;cursor:pointer;flex:0 0 auto}",
    ".ts-freq{flex:1;background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:800 italic 10.6px/1 ui-monospace,'SF Mono',Consolas,monospace;color:#fff;white-space:nowrap;text-shadow:0 0 8px rgba(186,230,253,.42)}",
    ".ts-freq small{font-size:6.0px;color:#93c5fd;margin-left:1px;font-weight:700;font-style:normal}",
    ".ts-vfo-tag{background:transparent;border:none;padding:0;font:800 italic 6.4px/1 system-ui;color:#93c5fd;cursor:pointer}",
    ".ts-subb{flex:1;background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:800 italic 7.6px/1 ui-monospace,monospace;color:#cbd5e1;white-space:nowrap}",
    ".ts-subb small{display:none}",
    ".ts-step-tag{background:rgba(15,23,42,.85);border:1px solid #334155;border-radius:1.5px;color:#e2e8f0;font:700 6.2px/1 ui-monospace,monospace;padding:1px 2.5px;cursor:pointer;white-space:nowrap}",
    ".ts-pb-row{display:flex;align-items:center;gap:3px;min-width:0}",
    ".ts-pb-svg{width:46px;height:10px;flex:0 0 46px;display:block}",
    ".ts-scope-info{flex:1;background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:700 6.3px/1 ui-monospace,monospace;color:#93c5fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".ts-scope-info b{color:#fff}",

    ".ts-scr-scope{position:relative;flex:1;min-height:46px;display:flex;flex-direction:column;background:#040914;border:1px solid rgba(59,130,246,.3);border-radius:2px;overflow:hidden}",
    ".ts-scr-scope.expand{min-height:66px}",
    ".ts-scope-cv{width:100%;flex:1;min-height:36px;display:block;cursor:crosshair}",
    ".ts-scope-axis{display:flex;justify-content:space-between;padding:1px 3px;background:#071022;font:700 6.3px/1 ui-monospace,monospace;color:#94a3b8}",
    ".ts-scope-axis .mid{color:#f8fafc;font-weight:800}",

    ".ts-scr-meta{display:flex;justify-content:space-between;align-items:center;gap:3px;padding:0 1px;font:700 6.6px/1.1 ui-monospace,monospace;color:#93c5fd;white-space:nowrap}",
    ".ts-status-msg{color:#fde047;font-weight:800;overflow:hidden;text-overflow:ellipsis;max-width:54%}",

    ".ts-softkeys{display:grid;grid-template-columns:repeat(7,1fr);gap:1.5px;flex:0 0 auto}",
    ".ts-softkeys button{height:12.5px;border-radius:1.5px;border:1px solid rgba(100,116,139,.4);background:linear-gradient(180deg,#232b3a,#121722);color:#e2e8f0;font:800 6.3px/1 system-ui;letter-spacing:-0.1px;cursor:pointer;padding:0}",
    ".ts-softkeys button:hover{border-color:rgba(var(--w2-licht-rgb),.7);color:#fff}",
    ".ts-softkeys button.an{background:linear-gradient(180deg,#28354c,#151e2e);border-color:rgba(var(--w2-licht-rgb),.8);color:#fff;box-shadow:inset 0 -1.5px 0 var(--w2-licht)}",

    /* Rechte Vertikal-Softkeys S1..S6 im TFT direkt an den Gehaeuse-Pfeilen */
    ".ts-srail{position:absolute;right:1.5px;top:3px;bottom:16px;width:22.5px;display:flex;flex-direction:column;justify-content:space-between;z-index:6}",
    ".ts-srail button{height:15px;border-radius:1.5px;border:1px solid rgba(71,85,105,.55);background:linear-gradient(180deg,#1b2638,#0d1524);color:#cbd5e1;font:800 6.2px/1 ui-monospace,monospace;padding:0;cursor:pointer}",
    ".ts-srail button:hover{border-color:var(--w2-licht);color:#fff}",
    ".ts-srail button.an{background:rgba(var(--w2-licht-rgb),.28);border-color:var(--w2-licht);color:#fff;box-shadow:inset -2px 0 0 var(--w2-licht)}",

    /* Inline TFT Popovers TS-890S */
    ".ts-pop{display:none;position:absolute;inset:2px;z-index:20;background:rgba(6,13,28,.97);border:1px solid var(--w2-licht);border-radius:3px;padding:4px 5px;flex-direction:column;gap:3px;box-shadow:0 0 18px rgba(0,0,0,.9)}",
    ".ts-pop.offen{display:flex}",
    ".ts-pop-hd{display:flex;justify-content:space-between;align-items:center;font:800 7.5px/1 system-ui;letter-spacing:.3px;color:#93c5fd;border-bottom:1px solid rgba(148,163,184,.25);padding-bottom:2px}",
    ".ts-pop-hd button{background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:2px;width:14px;height:14px;line-height:1;cursor:pointer;font-weight:800;padding:0}",
    ".ts-pop-grid{display:grid;gap:2.5px;flex:1;align-content:start}",
    ".ts-pop-grid.g5{grid-template-columns:repeat(5,1fr)}",
    ".ts-pop-grid.g3{grid-template-columns:repeat(3,1fr)}",
    ".ts-pop-grid button,.ts-wf-grp button,.ts-lvl-btns button{padding:3px 2px;border-radius:2px;border:1px solid #334155;background:#162238;color:#e2e8f0;font:700 7.0px/1 system-ui;cursor:pointer}",
    ".ts-pop-grid button.an,.ts-wf-grp button.an,.ts-lvl-btns button.an{background:rgba(var(--w2-licht-rgb),.38);border-color:var(--w2-licht);color:#fff}",
    ".ts-pop-allprof{padding:3px 5px;border-radius:2px;border:1px solid #475569;background:#0f2340;color:#bae6fd;font:800 7.0px/1 system-ui;cursor:pointer;text-align:center}",
    ".ts-pop-list{display:flex;flex-direction:column;gap:2px;overflow:auto}",
    ".ts-pop-list button{display:flex;justify-content:space-between;padding:3.5px 5px;border-radius:2px;border:1px solid #334155;background:#132036;color:#e2e8f0;font:700 7.5px/1 ui-monospace,monospace;cursor:pointer}",
    ".ts-lvl-grid{display:flex;flex-direction:column;gap:3.5px;flex:1}",
    ".ts-lvl-row{display:grid;grid-template-columns:26px 1fr 40px;align-items:center;gap:4px;font:800 7.5px/1 ui-monospace,monospace;color:#e2e8f0}",
    ".ts-lvl-row input{width:100%;accent-color:var(--w2-licht);margin:0;height:11px}",
    ".ts-lvl-row em{font-style:normal;text-align:right;color:#93c5fd}",
    ".ts-lvl-btns{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;margin-top:auto}",
    ".ts-wf-opts{display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;justify-content:space-between}",
    ".ts-wf-grp{display:flex;flex-direction:column;gap:1px}",
    ".ts-wf-grp b{font:800 6.0px/1 system-ui;color:#93c5fd}",
    ".ts-wf-grp div{display:flex;flex-wrap:wrap;gap:2px}",
    ".ts-wf-grp button{padding:2px 3.5px;font-size:6.5px}",
    ".ts-pad-disp{display:flex;justify-content:space-between;align-items:center;background:#0a152a;border:1px solid #334155;border-radius:2px;padding:2.5px 5px;font:800 10.5px/1 ui-monospace,monospace;color:#fff}",
    ".ts-pad-disp small{font-size:7px;color:#93c5fd}",
    ".ts-pad-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;flex:1}",
    ".ts-pad-grid button{border-radius:2px;border:1px solid #334155;background:#162238;color:#fff;font:800 9px/1 ui-monospace,monospace;cursor:pointer;padding:2.5px 0}",
    ".ts-pad-grid .ts-pad-clr{background:#451a1a;border-color:#7f1d1d}",
    ".ts-pad-grid .ts-pad-ent{grid-column:span 3;background:linear-gradient(180deg,#0284c7,#0369a1);border-color:#38bdf8;font:800 8px/1 system-ui;padding:3.5px 0}",

    /* Hardware-Tasten-Hotspots auf TS-890S (kein blauer Kasten, dezente Hinterleuchtung) */
    ".ts-spot{position:absolute;z-index:8;background:transparent;border:none;border-radius:2px;cursor:pointer;padding:0;transition:background .12s,box-shadow .12s;overflow:visible}",
    ".ts-spot-key::after{content:'';position:absolute;left:24%;right:24%;bottom:1.5px;height:1.5px;border-radius:1px;opacity:0;transition:opacity .12s;pointer-events:none}",
    ".ts-spot-s::after{left:36%;right:14%;bottom:1.5px}",
    ".fg-w2.ts-lit .ts-spot-key{box-shadow:inset 0 0 3px rgba(var(--w2-licht-rgb),.10)}",
    ".ts-spot-key:hover{background:radial-gradient(ellipse at 50% 50%,rgba(var(--w2-licht-rgb),.24) 0%,rgba(var(--w2-licht-rgb),0) 76%)}",
    ".ts-spot-key.an{background:radial-gradient(ellipse at 50% 56%,rgba(var(--w2-licht-rgb),.32) 0%,rgba(var(--w2-licht-rgb),.08) 66%,rgba(var(--w2-licht-rgb),0) 88%)}",
    ".ts-spot-key.an::after{opacity:1;background:var(--w2-licht);box-shadow:0 0 5px var(--w2-licht),0 0 2px #fff}",
    ".ts-spot-jack{border-radius:6px}",
    ".ts-spot-jack:hover{background:radial-gradient(circle at 50% 50%,rgba(var(--w2-licht-rgb),.22) 0%,rgba(var(--w2-licht-rgb),0) 74%)}",

    /* 8 Drehknopfe auf dem TS-890S Foto */
    ".ts-knob{position:absolute;z-index:9;border-radius:50%;cursor:ns-resize;display:flex;align-items:center;justify-content:center}",
    ".ts-knob-cv{width:100%;height:100%;display:block;pointer-events:none}",
    ".ts-knob-tag{position:absolute;bottom:-4px;right:-3px;background:rgba(10,14,22,.92);border:1px solid rgba(148,163,184,.5);color:#e2e8f0;font:800 6.2px/1 ui-monospace,monospace;padding:1px 2.5px;border-radius:2px;pointer-events:none}",
    ".ts-vfo-knob{cursor:grab}",
    ".ts-vfo-knob:active{cursor:grabbing}",

    /* ---- Menü-Fenster ---- */
    "#fg-menu{position:fixed;left:50%;top:60px;transform:translateX(-50%);width:min(980px,94vw);",
    "max-height:78vh;overflow-y:auto;display:none;z-index:2147483647;border-radius:12px;padding:12px 14px 14px;",
    "background:linear-gradient(180deg,#12231b 0%,#0a1310 100%);border:1px solid #2f4a3a;",
    "box-shadow:0 26px 60px rgba(0,0,0,.8);font:13px/1.45 system-ui,sans-serif;color:#dff3e8}",
    ".fgm-kopf{display:flex;align-items:center;gap:10px;margin-bottom:9px;flex-wrap:wrap}",
    /* [REITER] wie am echten Gerät: aktiver Reiter leuchtet */
    ".fgm-reiter{display:flex;gap:4px;flex-wrap:wrap;flex:1;min-width:0}",
    ".fgm-rk{background:#0e1c15;border:1px solid #2f4a3a;border-radius:6px;color:#9ec7b0;",
    "padding:6px 10px;font:800 10px/1 system-ui;letter-spacing:1.1px;cursor:pointer}",
    ".fgm-rk:hover{border-color:#4f8a68;color:#d8ffe8}",
    ".fgm-rk.an{background:linear-gradient(180deg,#2fe06a,#12904a);color:#04170c;",
    "border-color:#7bf3a8;box-shadow:0 0 12px rgba(60,220,120,.55)}",
    /* Einstellzeilen */
    ".fgm-koerper{display:flex;flex-direction:column;gap:6px}",
    ".fgm-zeile{display:flex;align-items:center;justify-content:space-between;gap:14px;",
    "padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.035);",
    "border:1px solid rgba(120,200,160,.14)}",
    ".fgm-ztext{min-width:0}",
    ".fgm-ztext b{display:block;font:800 11px/1.3 system-ui;letter-spacing:.9px;color:#c8f0dc}",
    ".fgm-ztext s{display:block;font:600 9.5px/1.3 system-ui;color:#7ba88f;text-decoration:none;margin-top:2px}",
    ".fgm-zrecht{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}",
    ".fgm-wahl{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}",
    ".fgm-knopf{background:linear-gradient(180deg,#22392e,#132218);border:1px solid #3d6a52;",
    "border-radius:5px;color:#bfe8d2;padding:6px 11px;font:800 10px/1 system-ui;",
    "letter-spacing:.8px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(180,255,220,.10)}",
    ".fgm-knopf:hover{border-color:#5fa87e;color:#eafff2}",
    ".fgm-knopf.an{background:linear-gradient(180deg,#2fe06a,#12904a);color:#04170c;",
    "border-color:#7bf3a8;box-shadow:0 0 12px rgba(60,220,120,.5)}",
    ".fgm-aus{font:800 10px/1 system-ui;letter-spacing:1px;color:#b06a6a;",
    "background:rgba(120,30,30,.25);border:1px solid #6d2f2f;border-radius:5px;padding:6px 10px}",
    ".fgm-hinweis{font:600 10px/1.3 system-ui;color:#8fb8a4}",
    ".fgm-schieber{width:190px;accent-color:#2fe06a}",
    ".fgm-wert{font:800 11px/1 ui-monospace,monospace;color:#9dffbb;min-width:56px;text-align:right}",
    /* Speicherliste */
    ".fgm-speicher{display:flex;flex-direction:column;gap:3px;margin-bottom:8px}",
    ".fgm-spzeile{display:grid;grid-template-columns:1fr 130px 70px 90px;gap:8px;align-items:center;",
    "padding:5px 9px;border-radius:6px;background:rgba(255,255,255,.03);",
    "font:700 10.5px/1.2 ui-monospace,monospace;color:#bfe8d2}",
    ".fgm-spkopf{background:transparent;color:#7ba88f;font:800 8.5px/1 system-ui;letter-spacing:1.2px}",
    ".fgm-profil-kopf{margin-bottom:8px}",
    ".fgm-kopf b{font:800 14px/1 system-ui;letter-spacing:1.6px;color:#9fe8bf;white-space:nowrap}",
    ".fgm-such{flex:1;min-width:0;padding:7px 10px;border-radius:8px;background:#08120e;",
    "border:1px solid #2f4a3a;color:#dff3e8;font:13px system-ui}",
    ".fgm-zu{cursor:pointer;font:900 17px/1 system-ui;color:#8fb8a4;padding:0 4px}",
    ".fgm-zu:hover{color:#fff}",
    ".fgm-jetzt{font:600 11.5px/1.5 ui-monospace,monospace;color:#8fb8a4;margin-bottom:9px}",
    ".fgm-jetzt b{color:#ffcf4a}",
    ".fgm-liste{overflow:auto;max-height:62vh;padding-right:4px}",
    ".fgm-gruppe{margin-bottom:11px}",
    ".fgm-gtitel{font:700 10px/1 system-ui;letter-spacing:1.5px;color:#6f9c86;margin:0 0 5px 2px}",
    ".fgm-gitter{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:5px}",
    ".fgm-eintrag{text-align:left;padding:7px 9px;border-radius:6px;cursor:pointer;",
    "background:#14251d;border:1px solid #274436;color:#cfe6d8;font:600 11px/1.3 ui-monospace,monospace}",
    ".fgm-eintrag:hover{background:#1c3529;color:#fff}",
    ".fgm-eintrag.an{background:#1f5c3c;border-color:#4ee08d;color:#eafff2;box-shadow:0 0 12px rgba(70,220,140,.35)}",
    ".fgm-leer{color:#8fb8a4;padding:16px 4px}",




    /* ---- Geraet 3: Touch-Konsole (720x327.48 px) ---- */
    ".fg-w3{width:720px;min-width:0;max-width:none;--w3-licht:#e2e8f0;--w3-leg:#ffffff;--w3-licht-rgb:226,232,240}",
    ".ic-shell{position:relative;width:720px;height:327.48px;user-select:none}",
    ".ic-stage{position:relative;width:720px;height:327.48px;transform-origin:top left}",
    ".ic-chassis{position:relative;width:100%;height:100%;cursor:grab;filter:drop-shadow(0 16px 30px rgba(0,0,0,.85))}",
    ".ic-chassis:active{cursor:grabbing}",
    ".ic-photo{display:block;width:100%;height:100%;pointer-events:none;border-radius:4px}",
    ".ic-photo-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4}",

    /* Obere Bezel-Zeile direkt ueber dem TFT (markenfrei retuschierte Blende) */
    ".ic-top-bar{position:absolute;z-index:13;display:flex;align-items:center;gap:2px;padding:1px 2.5px;",
    "background:linear-gradient(180deg,rgba(14,17,23,.95),rgba(8,10,15,.98));border:1px solid rgba(148,163,184,.22);",
    "border-radius:2.5px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 2px 4px rgba(0,0,0,.72)}",
    ".ic-tpill,.ic-tbtn{height:12.5px;padding:0 3.2px;border-radius:2px;border:1px solid rgba(71,85,105,.52);",
    "background:linear-gradient(180deg,#232933,#13171f);color:#e2e8f0;font:800 6.8px/1 ui-monospace,monospace;letter-spacing:0;",
    "cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:2px;",
    "box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 1px 2px rgba(0,0,0,.55)}",
    ".ic-tpill{cursor:ns-resize}",
    ".ic-tpill:hover,.ic-tbtn:hover{border-color:rgba(var(--w3-licht-rgb),.7);color:#fff}",
    ".ic-tpill.an,.ic-tbtn.an{background:linear-gradient(180deg,#263042,#161d29);border-color:rgba(var(--w3-licht-rgb),.78);color:#fff;box-shadow:inset 0 -2px 0 var(--w3-licht),0 0 6px rgba(var(--w3-licht-rgb),.42)}",
    ".ic-tbtn i{display:inline-block;width:5.5px;height:5.5px;border-radius:50%;background:#e2e8f0;border:1px solid rgba(255,255,255,.5)}",
    ".ic-tbtn em{font:700 6.6px/1 ui-monospace,monospace;font-style:normal;color:#cbd5e1}",
    ".ic-tmenu{margin-left:auto;padding:0 5px;font-size:8.5px}",

    /* Touch-TFT im Rahmen */
    ".ic-screen-slot{position:absolute;z-index:10;overflow:hidden;border-radius:2.5px;padding:2.5px 4px;",
    "background:linear-gradient(180deg,#0a1220 0%,#060b16 62%,#03060d 100%);",
    "box-shadow:inset 0 0 0 1px rgba(148,197,255,.18),inset 0 0 22px rgba(var(--w3-licht-rgb),.10);",
    "display:flex;flex-direction:column;gap:2px;transition:filter .16s}",
    ".ic-screen-slot.dim{filter:brightness(.36) saturate(.7)}",

    ".ic-scr-hd{display:flex;align-items:center;gap:2px;height:11.5px;flex:0 0 auto}",
    ".ic-mode-badge{background:linear-gradient(180deg,#0ea5e9,#0284c7);border:none;border-radius:2px;color:#fff;font:800 7.2px/1.1 system-ui;padding:1.5px 4px;cursor:pointer;flex:0 0 auto}",
    ".ic-hd-tag{height:11px;padding:0 2.5px;border-radius:1.5px;border:1px solid rgba(96,165,250,.32);background:rgba(16,32,58,.9);color:#93c5fd;font:800 6.3px/1 ui-monospace,monospace;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:1.5px}",
    ".ic-hd-tag em{font-style:normal;color:#fff}",
    ".ic-hd-tag.an{border-color:var(--w3-licht);background:rgba(var(--w3-licht-rgb),.28)}",
    ".ic-ind-tags{display:flex;gap:1.5px;margin-left:auto}",
    ".ic-ind-tags i{font:800 6.2px/1 system-ui;font-style:normal;padding:1.5px 2px;border-radius:1.5px;background:rgba(15,23,42,.75);color:#64748b;border:1px solid rgba(71,85,105,.4)}",
    ".ic-ind-tags i.an{background:rgba(var(--w3-licht-rgb),.34);color:#fff;border-color:var(--w3-licht)}",
    ".ic-lvl-btn{height:11px;padding:0 3.5px;border-radius:1.5px;border:1px solid #60a5fa;background:linear-gradient(180deg,#1a335c,#102242);color:#dbeafe;font:800 6.4px/1 system-ui;cursor:pointer}",
    ".ic-lvl-btn:hover{background:#1d4ed8;color:#fff}",

    ".ic-scr-top{display:grid;grid-template-columns:1fr 78px;gap:5px;align-items:stretch;flex:0 0 auto}",
    ".ic-vfo-main{display:flex;flex-direction:column;gap:1.5px;min-width:0}",
    ".ic-vfoa-row{display:flex;align-items:center;gap:4px;min-width:0}",
    ".ic-freq{flex:1;background:transparent;border:none;padding:0;text-align:left;cursor:pointer;font:800 14.5px/1 ui-monospace,'SF Mono',Consolas,monospace;color:#fff;white-space:nowrap;letter-spacing:.2px;text-shadow:0 0 10px rgba(186,230,253,.42)}",
    ".ic-freq small{font-size:7.2px;color:#93c5fd;margin-left:1.5px;font-weight:700}",
    ".ic-vfo-side{display:flex;flex-direction:column;align-items:flex-end;gap:0.5px;flex:0 0 auto}",
    ".ic-vfo-tag{background:transparent;border:none;padding:0;font:800 6.6px/1 system-ui;color:#38bdf8;cursor:pointer}",
    ".ic-subb{background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:700 7.2px/1 ui-monospace,monospace;color:#cbd5e1;white-space:nowrap}",
    ".ic-subb small{display:none}",

    /* Authentic Icom-Stil Segmented Digital S-Meter */
    ".ic-meter-wrap{display:flex;flex-direction:column;gap:1px;padding:1.5px 3px;background:rgba(7,14,28,.9);border:1px solid rgba(71,85,105,.42);border-radius:2px}",
    ".ic-sm-scale{display:flex;justify-content:space-between;align-items:baseline;font:800 6.0px/1 ui-monospace,monospace;color:#e2e8f0;padding:0 1px}",
    ".ic-sm-scale .ic-sm-k{color:#93c5fd;font-family:system-ui}",
    ".ic-sm-scale .r{color:#f87171}",
    ".ic-sm-scale small{font-size:5.0px}",
    ".ic-sm-bar{display:grid;grid-template-columns:repeat(32,1fr);gap:1.2px;height:5.5px;align-items:stretch}",
    ".ic-sm-bar i{display:block;border-radius:0.8px;background:rgba(51,65,85,.52)}",
    ".ic-sm-bar i.mid{background:rgba(30,64,115,.55)}",
    ".ic-sm-bar i.red{background:rgba(127,29,29,.45)}",
    ".ic-sm-bar i.an{background:#f8fafc;box-shadow:0 0 3px rgba(248,250,252,.65)}",
    ".ic-sm-bar i.mid.an{background:#38bdf8;box-shadow:0 0 4px rgba(56,189,248,.75)}",
    ".ic-sm-bar i.red.an{background:#ef4444;box-shadow:0 0 5px rgba(239,68,68,.85)}",
    ".ic-sm-bar i.pk{background:#fbbf24;box-shadow:0 0 4px #fbbf24}",
    ".ic-sm-po{display:flex;justify-content:space-between;align-items:center;font:700 5.6px/1 ui-monospace,monospace;color:#94a3b8;padding:0 1px}",
    ".ic-sm-po em{font-style:normal;color:#fde68a;font-weight:800}",

    ".ic-pb-col{display:flex;flex-direction:column;justify-content:space-between;gap:2px;min-width:0;padding:1px 0}",
    ".ic-pb-svg{width:100%;height:14px;display:block;background:rgba(10,18,34,.78);border:1px solid rgba(51,65,85,.45);border-radius:2px}",
    ".ic-pb-tags{display:flex;flex-direction:column;align-items:flex-end;gap:1.5px}",
    ".ic-step-tag{background:rgba(15,23,42,.85);border:1px solid #334155;border-radius:1.5px;color:#e2e8f0;font:700 6.2px/1 ui-monospace,monospace;padding:1.5px 3px;cursor:pointer;white-space:nowrap}",
    ".ic-scope-info{background:transparent;border:none;padding:0;text-align:right;cursor:pointer;font:700 6.1px/1 ui-monospace,monospace;color:#93c5fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}",
    ".ic-scope-info b{color:#fff}",

    ".ic-scr-scope{position:relative;flex:1;min-height:46px;display:flex;flex-direction:column;background:#040914;border:1px solid rgba(59,130,246,.32);border-radius:2px;overflow:hidden}",
    ".ic-scr-scope.expand{min-height:62px}",
    ".ic-scope-cv{width:100%;flex:1;min-height:30px;display:block;cursor:crosshair}",
    ".ic-scope-axis{display:flex;justify-content:space-between;padding:1px 3px;background:#071022;font:700 6.5px/1 ui-monospace,monospace;color:#94a3b8}",
    ".ic-scope-axis .mid{color:#f8fafc;font-weight:800}",

    ".ic-scr-meta{display:flex;justify-content:space-between;align-items:center;gap:4px;padding:0 1px;font:700 6.6px/1.1 ui-monospace,monospace;color:#93c5fd;white-space:nowrap}",
    ".ic-status-msg{color:#fde047;font-weight:800;overflow:hidden;text-overflow:ellipsis;max-width:52%}",

    ".ic-softkeys{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;flex:0 0 auto}",
    ".ic-softkeys button{height:13.5px;border-radius:2px;border:1px solid rgba(100,116,139,.44);background:linear-gradient(180deg,#263040,#141a26);color:#e2e8f0;font:800 6.4px/1 system-ui;letter-spacing:.15px;cursor:pointer;padding:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)}",
    ".ic-softkeys button:hover{border-color:rgba(var(--w3-licht-rgb),.7);color:#fff}",
    ".ic-softkeys button.an{background:linear-gradient(180deg,#28354c,#151e2e);border-color:rgba(var(--w3-licht-rgb),.82);color:#fff;box-shadow:inset 0 -2px 0 var(--w3-licht),0 0 6px rgba(var(--w3-licht-rgb),.4)}",

    /* Inline TFT Popovers */
    ".ic-pop{display:none;position:absolute;inset:2px;z-index:20;background:rgba(6,13,28,.97);border:1px solid var(--w3-licht);border-radius:3px;padding:4px 5px;flex-direction:column;gap:2.5px;box-shadow:0 0 18px rgba(0,0,0,.9)}",
    ".ic-pop.offen{display:flex}",
    ".ic-pop-hd{display:flex;justify-content:space-between;align-items:center;font:800 7.6px/1 system-ui;letter-spacing:.4px;color:#93c5fd;border-bottom:1px solid rgba(148,163,184,.25);padding-bottom:2px}",
    ".ic-pop-hd button{background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:2px;width:14px;height:14px;line-height:1;cursor:pointer;font-weight:800;padding:0}",
    ".ic-pop-grid{display:grid;gap:2px;flex:1;align-content:start}",
    ".ic-pop-grid.g5{grid-template-columns:repeat(5,1fr)}",
    ".ic-pop-grid.g3{grid-template-columns:repeat(3,1fr)}",
    ".ic-pop-grid button,.ic-wf-grp button,.ic-lvl-btns button{padding:3px 2px;border-radius:2px;border:1px solid #334155;background:#162238;color:#e2e8f0;font:700 7.2px/1 system-ui;cursor:pointer}",
    ".ic-pop-grid button.an,.ic-wf-grp button.an,.ic-lvl-btns button.an{background:rgba(var(--w3-licht-rgb),.35);border-color:var(--w3-licht);color:#fff}",
    ".ic-pop-allprof{padding:3px 5px;border-radius:2px;border:1px solid #475569;background:#0f2340;color:#bae6fd;font:800 7.2px/1 system-ui;cursor:pointer;text-align:center}",
    ".ic-pop-list{display:flex;flex-direction:column;gap:2px;overflow:auto}",
    ".ic-pop-list button{display:flex;justify-content:space-between;padding:3.5px 5px;border-radius:2px;border:1px solid #334155;background:#132036;color:#e2e8f0;font:700 7.6px/1 ui-monospace,monospace;cursor:pointer}",
    ".ic-lvl-grid{display:flex;flex-direction:column;gap:3.5px;flex:1}",
    ".ic-lvl-row{display:grid;grid-template-columns:26px 1fr 40px;align-items:center;gap:4px;font:800 7.6px/1 ui-monospace,monospace;color:#e2e8f0}",
    ".ic-lvl-row input{width:100%;accent-color:var(--w3-licht);margin:0;height:11px}",
    ".ic-lvl-row em{font-style:normal;text-align:right;color:#93c5fd}",
    ".ic-lvl-btns{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;margin-top:auto}",
    ".ic-wf-opts{display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;justify-content:space-between}",
    ".ic-wf-grp{display:flex;flex-direction:column;gap:1px}",
    ".ic-wf-grp b{font:800 5.8px/1 system-ui;color:#93c5fd}",
    ".ic-wf-grp div{display:flex;flex-wrap:wrap;gap:2px}",
    ".ic-wf-grp button{padding:2px 3.5px;font-size:6.4px}",
    ".ic-pad-disp{display:flex;justify-content:space-between;align-items:center;background:#0a152a;border:1px solid #334155;border-radius:2px;padding:2.5px 5px;font:800 10px/1 ui-monospace,monospace;color:#fff}",
    ".ic-pad-disp small{font-size:6.8px;color:#93c5fd}",
    ".ic-pad-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;flex:1}",
    ".ic-pad-grid button{border-radius:2px;border:1px solid #334155;background:#162238;color:#fff;font:800 8.5px/1 ui-monospace,monospace;cursor:pointer;padding:2px 0}",
    ".ic-pad-grid .ic-pad-clr{background:#451a1a;border-color:#7f1d1d}",
    ".ic-pad-grid .ic-pad-ent{grid-column:span 3;background:linear-gradient(180deg,#0284c7,#0369a1);border-color:#38bdf8;font:800 7.6px/1 system-ui;padding:3px 0}",

    /* Hardware-Tasten-Hotspots auf Funkgeraet 3 */
    ".ic-spot{position:absolute;z-index:8;background:transparent;border:none;border-radius:2px;cursor:pointer;padding:0;color:transparent;font-size:0;transition:background .12s,box-shadow .12s;overflow:visible}",
    ".ic-spot-key::after{content:'';position:absolute;left:24%;right:24%;bottom:1.5px;height:1.5px;border-radius:1px;opacity:0;transition:opacity .12s;pointer-events:none}",
    ".fg-w3.ic-lit .ic-spot-key{box-shadow:inset 0 0 3px rgba(var(--w3-licht-rgb),.08)}",
    ".ic-spot-key:hover{background:radial-gradient(ellipse at 50% 50%,rgba(var(--w3-licht-rgb),.22) 0%,rgba(var(--w3-licht-rgb),0) 76%)}",
    ".ic-spot-key.an{background:radial-gradient(ellipse at 50% 56%,rgba(var(--w3-licht-rgb),.30) 0%,rgba(var(--w3-licht-rgb),.08) 66%,rgba(var(--w3-licht-rgb),0) 88%)}",
    ".ic-spot-key.an::after{opacity:1;background:var(--w3-licht);box-shadow:0 0 5px var(--w3-licht),0 0 2px #fff}",
    ".ic-spot-jack{border-radius:50%}",
    ".ic-spot-jack:hover{background:radial-gradient(circle at 50% 50%,rgba(var(--w3-licht-rgb),.22) 0%,rgba(var(--w3-licht-rgb),0) 74%)}",

    /* 4 Drehregler (inkl. Dual-Concentric AF/RF-SQL) */
    ".ic-knob{position:absolute;z-index:9;border-radius:50%;cursor:ns-resize;display:flex;align-items:center;justify-content:center}",
    ".ic-knob-outer{z-index:9}",
    ".ic-knob-inner{z-index:11}",
    ".ic-knob-cv{width:100%;height:100%;display:block;pointer-events:none}",
    ".ic-vfo-knob{cursor:grab}",
    ".ic-vfo-knob:active{cursor:grabbing}",

    /* Aktive Kenwood-W2-Sichtbarkeit & 111-Paritaet */
    ".fg-w2{min-width:0;max-width:none}",

    /* CB-Geraete verdeckt halten */
    "#dnx-george2,#dnx-ae6290,#dnx-g2-knopf{display:none !important}"
  ].join("\n");

  /* ================= Start ============================================ */
  function start() {
    menuStandLaden();
    var st = document.createElement("style");
    st.id = "dnx-funkgeraete-stil";
    st.textContent = CSS;
    document.head.appendChild(st);

    lesen();
    FENSTER[0] = bauenV1(0);
    FENSTER[1] = bauenV2(1);
    FENSTER[2] = bauenV3(2);
    zeichnen();
    brueckeBauen();

    /* Nur auf fremden OpenWebRX+-Installationen ohne DNX-Styler-Leiste:
       dezenter Eigen-Schalter, falls beide Geraete geschlossen wurden. */
    function standaloneKnopfPruefen() {
      try {
        var hatStyler = !!document.getElementById("dnx-master-tool-row") ||
          typeof window.dnxFunkKnopfAuffrischen === "function";
        var alt = document.getElementById("dnx-fg-standalone-btn");
        if (hatStyler) {
          if (alt && alt.parentNode) { alt.parentNode.removeChild(alt); }
          return;
        }
        if (!alt) {
          alt = document.createElement("button");
          alt.id = "dnx-fg-standalone-btn";
          alt.type = "button";
          alt.title = "Funkgeräte 1–3 ein-/ausblenden";
          alt.style.cssText =
            "position:fixed;right:14px;bottom:14px;z-index:2147483500;cursor:pointer;" +
            "padding:7px 12px;border-radius:18px;border:1.5px solid #48c980;" +
            "background:linear-gradient(180deg,#143023,#0b1c14);color:#d7ffea;" +
            "font:800 12px/1 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.6)";
          alt.textContent = "Funkgeräte";
          alt.onclick = function () {
            var an = !(Z.geraete[0].offen || Z.geraete[1].offen || (Z.geraete[2] && Z.geraete[2].offen));
            Z.geraete[0].offen = an;
            Z.geraete[1].offen = an;
            if (Z.geraete[2]) { Z.geraete[2].offen = false; }
            sichern(); zeichnen();
          };
          document.body.appendChild(alt);
        }
      } catch (e) { }
    }
    setTimeout(standaloneKnopfPruefen, 1500);
    setInterval(standaloneKnopfPruefen, 4000);

    var _slowTick = 0;
    setInterval(function () {
      var rohAnteil = pegelJetzt();
      _slowTick++;
      var slow = (_slowTick % 5 === 1);
      var dbW = slow ? smeterDb() : null;
      var profW = slow ? profilNameKurz() : null;
      var uhrStr = (slow && MENU_STAND.zeit) ? new Date().toLocaleTimeString("de-DE") : "";
      Z.geraete.forEach(function (g, i) {
        var geglaettet = smeterGlaetten(i, rohAnteil);
        if (g._smeter) {
          var pkV = (SM_PEAK[i] && SM_PEAK[i].v) || geglaettet;
          if (g._smeter.meterV2) { meterSetzenV2(g._smeter, geglaettet, pkV); }
          else if (g._smeter.meterV3) { meterSetzenV3(g._smeter, geglaettet, pkV); }
          else if (g._smeter.balken) { bogenSetzen(g._smeter, geglaettet, pkV); }
          else { smeterSetzen(g._smeter, geglaettet); }
        }
        if (!slow) { return; }
        var wF = FENSTER[i];
        if (wF) {
          var dF = wF.querySelector('[data-feld="db"]');
          if (dF) { dF.textContent = (dbW === null) ? "—" : (dbW.toFixed(1) + " dB"); }
          var pF = wF.querySelector('[data-feld="profil"]');
          if (pF) { pF.textContent = profW + (uhrStr ? (" · " + uhrStr) : ""); }
          ledsSetzen(i, g, wF);
          passbandAktualisieren(wF, i >= 1);
        }
      });
    }, 65);
    setTimeout(rfApiLaden, 1800);
    setInterval(rfApiLaden, 15000);
    document.addEventListener("change", function (ev) {
      if (ev.target && ev.target.id === "openwebrx-sdr-profiles-listbox") {
        setTimeout(rfApiLaden, 350);
        setTimeout(rfApiLaden, 3500);
      }
    }, true);
    window.addEventListener("dnx-rf-gain-sync", function (ev) {
      var d = ev && ev.detail;
      if (!d || d.quelle === "funkgeraet") { return; }
      if (typeof d.darfAendern === "boolean") { _rfState.darfAendern = d.darfAendern; }
      if (typeof d.qDirect === "boolean") { _rfState.qDirect = d.qDirect; }
      if (d.modus) { _rfState.modus = d.modus; }
      if (typeof d.wert === "number") {
        MENU_STAND.rf = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(d.wert)));
        menuStandSichern();
      }
      reglerSyncAlle();
    });
    window.addEventListener("dnx-rf-gain", function (ev) {
      var d = ev && ev.detail;
      if (!d || d.quelle === "funkgeraet") { return; }
      if (d.gespeichert) { setTimeout(rfApiLaden, 150); return; }
      if (typeof d.wert === "number") {
        _rfState.modus = d.modus || "manual";
        MENU_STAND.rf = Math.max(RF_MIN, Math.min(RF_MAX, Math.round(d.wert)));
        menuStandSichern();
        reglerSyncAlle();
      }
    });

    /* Live-2D/3D-Wasserfall im Geraet 1 laufend nachziehen + dnx_3dtool synchron halten */
    setInterval(function () {
      try {
        fftHookInstallieren();
        if (FENSTER[0] && Z.geraete[0] && Z.geraete[0].offen) {
          scopeZeichnen(0, FENSTER[0], false);
        }
        if (FENSTER[1] && Z.geraete[1] && Z.geraete[1].offen) {
          scopeZeichnen(1, FENSTER[1], false);
        }
        if (FENSTER[2] && Z.geraete[2] && Z.geraete[2].offen) {
          scopeZeichnen(2, FENSTER[2], false);
        }
      } catch (e) { }
    }, 110);

    /* Der Empfänger kann auch von aussen verstellt werden (Receiver-Panel,
       Profilwechsel, anderer Besucher). Beide Geräte ziehen nach. */
    setInterval(mitlaufen, 700);
    setTimeout(mitlaufen, 1200);

    /* [CB VERDECKT] 20.11.2026: Frueher wurde hier dnxGeorge2.zeige(false)
       gerufen, um das alte CB-Geraet zu verstecken. Seit die Schalter der
       Werkzeugreihe ueber dnxGeorge2 auf DIESE beiden Geraete zeigen, haette
       das die eigenen Geraete zugemacht - sie starteten als "Aus".
       Jetzt wird nur noch das echte CB-Geraet versteckt, nie die eigenen. */
    function cbVerdecken() {
      try {
        var cbg = document.getElementById("dnx-george2");
        if (cbg) { cbg.style.setProperty("display", "none", "important"); }
        var cba = document.getElementById("dnx-ae6290");
        if (cba) { cba.style.setProperty("display", "none", "important"); }
      } catch (e) { }
    }
    cbVerdecken();
    var v = setInterval(function () {
      cbVerdecken();
      try {
        ["dnx-g2-knopf"].forEach(function (id) {
          var el = document.getElementById(id);
          if (el && el.style.display !== "none") { el.style.display = "none"; }
        });
      } catch (e) { }
    }, 900);
    setTimeout(function () { clearInterval(v); }, 20000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  /* ================= Griffe nach aussen =============================== */
  /* ================= Bruecke zu den Schaltern der Werkzeugreihe ==========
     [AN/AUS] 20.11.2026: In der Werkzeugreihe sitzen (vom Styler gebaut)
     zwei Knoepfe "Funkgerät 1: An/Aus" und "Funkgerät 2: An/Aus". Die haben
     bisher mit window.dnxGeorge2 geredet - dem alten CB-Geraet. Auf 111
     gehoeren sie zu den beiden Funkgeraeten, auf 113 standen sie deshalb
     auf "Aus", waehrend meine Geraete offen blieben.
     Hier bekommt window.dnxGeorge2 die passenden Griffe, damit die Schalter
     genau diese beiden Geraete ein- und ausschalten. */
  /* Das CB-Modul (dnx_george2.js) laedt NACH diesem Modul und setzt
     window.dnxGeorge2 komplett neu - eine einmal gesetzte Bruecke war damit
     wieder weg (live nachgemessen: hatBruecke=false). Deshalb haengt sich
     die Bruecke an die Zuweisung selbst: egal wer window.dnxGeorge2 setzt,
     die Griffe fuer die Schalter kommen immer mit. */
  var _gg = null;
  function brueckeMischen(o) {
    if (!o) { o = {}; }
    function idxVonNr(nr) {
      var s = String(nr);
      return (s === "3") ? 2 : ((s === "2") ? 1 : 0);
    }
    o.stand = function () {
      return {
        offen: !!(Z.geraete[0] && Z.geraete[0].offen), eins: !!(Z.geraete[0] && Z.geraete[0].offen),
        aeOffen: !!(Z.geraete[1] && Z.geraete[1].offen), zwei: !!(Z.geraete[1] && Z.geraete[1].offen),
        p3Offen: !!(Z.geraete[2] && Z.geraete[2].offen), drei: !!(Z.geraete[2] && Z.geraete[2].offen)
      };
    };
    o.stand2 = o.stand;
    o.zeige = function (ja) { return apiZeige(0, ja); };
    o.zeige2 = function (ja) { return apiZeige(1, ja); };
    o.zeige3 = function (ja) { return apiZeige(2, ja); };
    o.geraetAn = function (nr) { return apiZeige(idxVonNr(nr), true) || true; };
    o.geraetAus = function (nr) { apiZeige(idxVonNr(nr), false); return true; };
    o.nurAktiv = function (nr) {
      var idx = idxVonNr(nr);
      Z.aktiv = idx;
      try { localStorage.setItem("dnx_ae6290_aktiv", String(idx + 1)); } catch (e) { }
      sichern();
      return String(idx + 1);
    };
    o.aktiv = function () {
      return String((Z.aktiv === 2 ? 3 : (Z.aktiv === 1 ? 2 : 1)));
    };
    o.rf = function (w) { rfAnwenden(w); return MENU_STAND.rf; };
    o.rfWert = function () { return MENU_STAND.rf; };
    o.einAus = function (nr) {
      var i = idxVonNr(nr);
      var g = Z.geraete[i];
      if (!g) { return false; }
      g.offen = !g.offen;
      if (g.offen) { Z.aktiv = i; }
      sichern(); zeichnen();
      apiAuffrischen();
      return g.offen;
    };
    return o;
  }
  function apiAuffrischen() {
    try {
      if (typeof window.dnxFunkKnopfAuffrischen === "function") { window.dnxFunkKnopfAuffrischen(); }
      else if (typeof window.__dnxFunkSync === "function") { window.__dnxFunkSync(); }
    } catch (e) { }
  }
  function brueckeBauen() {
    try {
      if (window.__dnxGgWache) { return; }
      window.__dnxGgWache = 1;
      _gg = brueckeMischen(window.dnxGeorge2 || {});
      Object.defineProperty(window, "dnxGeorge2", {
        configurable: true,
        get: function () { return _gg; },
        set: function (v) { _gg = brueckeMischen(v); }
      });
    } catch (e) { }
  }
  function apiZeige(i, ja) {
    var g = Z.geraete[i];
    if (!g) { return false; }
    g.offen = (ja !== false);
    sichern(); zeichnen();
    apiAuffrischen();
    return g.offen;
  }

  window.addEventListener("resize", function () {
    Z.geraete.forEach(function (g, idx) {
      if (g && g.offen && FENSTER[idx]) {
        resizeAnwenden(FENSTER[idx], g);
        fensterKlemmen(FENSTER[idx], g);
        if (typeof scopeZeichnen === "function") { scopeZeichnen(idx, FENSTER[idx], true); }
      }
    });
  });

  window.dnxFunkgeraete = {
    fassung: FASSUNG,
    zeige: function (i, ja) {
      var g = Z.geraete[i];
      if (!g) { return false; }
      g.offen = (ja !== false);
      sichern(); zeichnen();
      return g.offen;
    },
    einstellen: function (i, hz, modus) { abstimmen(i, hz, modus || null, null); return Z.geraete[i]; },
    band: function (i, name) {
      var b = BAENDER.filter(function (x) { return x.n === name; })[0];
      if (!b) { return false; }
      /* wie ein Tastendruck: im Fenster abstimmen, sonst Profil wechseln */
      return bandWaehlen(i, b);
    },
    speicher: function (i, nr) {
      var s = SPEICHER[nr];
      if (!s) { return false; }
      return abstimmen(i, s.hz, s.m, s.n);
    },
    taste: function (i, z) { tasteV1(i, z); return EINGABE[i]; },
    enter: function (i) { enterV1(i); return Z.geraete[i].hz; },
    stand: function () {
      return {
        fassung: FASSUNG,
        geraete: Z.geraete.map(function (g, i) {
          return { nr: i + 1, art: g.art, hz: g.hz, mhz: hzKurz(g.hz), modus: g.modus,
                   schritt: g.schritt, offen: g.offen, x: g.x, y: g.y };
        })
      };
    },
    empfaenger: { frequenz: empfangenLesen, fenster: fensterJetzt },
    profil: {
      jetzt: profilJetzt,
      kurz: profilNameKurz,
      liste: function () { return profilGruppen().map(function (g) { return { id: g.id, titel: g.titel, anzahl: g.eintraege.length }; }); },
      wechseln: profilWechseln,
      fuerBand: function (b) { var p = profilFuerBand(b); return p ? { wert: p.value, text: p.textContent } : null; }
    },
    menu: { zeigen: menuZeigen },
    lautstaerke: { jetzt: lautstaerkeJetzt, setzen: lautstaerkeSetzen },
    smeter: {
      roh: smeterRoh,
      db: smeterDb,
      anteil: smeterAnteil
    },
    licht: {
      jetzt: lichtIdLesen,
      setzen: lichtAnwenden
    },
    scope: {
      modus: function (m) {
        if (m) {
          if (m === "multi") { SCOPE.mode = "multi"; scopeCfgSichern(); }
          else { dnx3dModusSetzen(m); }
          if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
        }
        return SCOPE.mode;
      },
      palette: function (p) {
        if (p && (p === "owrx" || SCOPE_PALETTES[p])) {
          SCOPE.palette = p; scopeCfgSichern();
          if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
          if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); }
          if (FENSTER[2]) { scopeZeichnen(2, FENSTER[2], true); }
        }
        return SCOPE.palette;
      },
      richtung: function (dir) {
        if (dir === "auf" || dir === false) { SCOPE.wfDown = false; scopeCfgSichern(); }
        else if (dir === "ab" || dir === true) { SCOPE.wfDown = true; scopeCfgSichern(); }
        if (FENSTER[0]) { scopeZeichnen(0, FENSTER[0], true); }
        if (FENSTER[1]) { scopeZeichnen(1, FENSTER[1], true); }
        if (FENSTER[2]) { scopeZeichnen(2, FENSTER[2], true); }
        return SCOPE.wfDown ? "abwaerts" : "aufwaerts";
      }
    },
    dw: function () { dwToggle(0); return DW_STATE.aktiv; },
    scan: function () { scanToggle(0); return SCAN_STATE.aktiv; },
    vol: { jetzt: volProzent, setzen: volSetzen },
    wechsel: function (nr) {
      var z = (nr === 3 || nr === "3") ? 2 : ((nr === 2 || nr === "2") ? 1 : 0);
      geraetWechsel(z);
      return Z.aktiv + 1;
    },
    groesse: function (i, w) {
      var g = Z.geraete[i];
      if (!g) { return null; }
      if (typeof w === "number" && isFinite(w)) {
        var minW = (g.art === "v1") ? 460 : 440;
        var maxW = Math.min(1500, Math.max(minW, (window.innerWidth || 1600) - 16));
        g.w = Math.max(minW, Math.min(maxW, Math.round(w)));
        resizeAnwenden(FENSTER[i], g);
        fensterKlemmen(FENSTER[i], g);
        sichern();
        if (FENSTER[i]) {
          scopeZeichnen(i, FENSTER[i], true);
          if (g.art === "v1" && typeof ftKnobsRedraw === "function") { ftKnobsRedraw(FENSTER[i]); }
          if (g.art === "v2" && typeof tsKnobsRedraw === "function") { tsKnobsRedraw(FENSTER[i]); }
          if (g.art === "v3" && typeof icKnobsRedraw === "function") { icKnobsRedraw(FENSTER[i]); }
        }
      }
      return g.w;
    },
    rf: {
      laden: rfApiLaden,
      setzen: rfAnwenden,
      stand: function () {
        return {
          wert: MENU_STAND.rf, modus: _rfState.modus, darfAendern: _rfState.darfAendern,
          qDirect: _rfState.qDirect, serverWert: _rfState.serverWert
        };
      }
    }
  };
})();
