#!/usr/bin/env bash
# =====================================================================
#  DNX HF-Funkgeraete Remote  v1.1.0  -  Installer / Updater / Entferner
# ---------------------------------------------------------------------
#  Enthaelt 3 markenfreie Allmode/HF/KW-Funkgeraete inklusive Frontplatten:
#    - dnx_funkgeraete.js
#    - funkgeraet1_ft710_v8_113.png
#    - funkgeraet2_ts890_v822.png
#    - funkgeraet3_ic7300_v824.png
#
#  Aufruf:
#     sudo ./install.sh              (fragt normal vs. Docker und baut ein)
#     sudo ./install.sh install      einbauen
#     sudo ./install.sh update       neu einbauen (Dateien aktualisieren)
#     sudo ./install.sh status       Einbauzustand pruefen
#     sudo ./install.sh uninstall    restlos entfernen
#
#  Direktwahl ohne Rueckfrage (optional per Umgebungsvariable):
#     sudo TYP=normal PLUGINS=/pfad/zu/plugins ./install.sh install
#     sudo TYP=docker CONTAINER=owrx-8011 ./install.sh install
#     sudo NORESTART=1 ./install.sh install
#
#  Unterstuetzt sowohl:
#     1) Normale OpenWebRX / OpenWebRX+ Installationen direkt auf Linux
#     2) Docker-Images / Docker-Container (mit Bind-Mount ODER per docker cp)
#
#  Private, inoffizielle Hobby-Anpassung; kein offizielles
#  OpenWebRX-/OpenWebRX+-Projekt. Nutzung auf eigene Gefahr.
# =====================================================================
set -Eeuo pipefail

CMD=${1:-install}
TYP_VORGABE=${TYP:-}
PLUGINS_VORGABE=${PLUGINS:-}
CONTAINER_VORGABE=${CONTAINER:-}
NORESTART=${NORESTART:-0}
HERE=$(cd "$(dirname "$0")" && pwd)

DATEIEN=(
  "dnx_funkgeraete.js"
  "funkgeraet1_ft710_v8_113.png"
  "funkgeraet2_ts890_v822.png"
  "funkgeraet3_ic7300_v824.png"
)

MARK_A="/* DNX_HF_FUNK_START */"
MARK_B="/* DNX_HF_FUNK_END */"

if [ -w "/opt" ] || [ "$(id -u)" -eq 0 ]; then
  BACK="${BACK_DIR:-/opt/dnx-hf-funk-backups}"
else
  BACK="${BACK_DIR:-$HOME/.dnx-hf-funk-backups}"
fi

# Ziel-Zustand nach Auswahl
ZIEL_ART=""      # "normal" oder "docker-mount" oder "docker-cp"
S=""             # Host-Pfad zum plugins-Verzeichnis (bei normal oder docker-mount)
I=""             # Host-Pfad zu receiver/init.js
CONT=""          # Docker-Container-Name
C_PLUGINS=""     # Pfad zum plugins-Verzeichnis IM Container (bei docker-cp)

# --- Hilfsfunktionen -------------------------------------------------
pruefe_root_falls_noetig() {
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  # Nicht-root nur erlauben, wenn direkt schreibbarer PLUGINS-Pfad vorgegeben wurde
  if [ -n "$PLUGINS_VORGABE" ] && [ -d "$PLUGINS_VORGABE" ] && [ -w "$PLUGINS_VORGABE" ]; then
    return 0
  fi
  echo "FEHLER: Bitte mit sudo (oder als root) aufrufen:  sudo $0 $CMD" >&2
  exit 1
}

suche_normal_kandidaten() {
  local p
  local treffer=()
  local schon=""
  for p in \
    /usr/lib/python3/dist-packages/htdocs/plugins \
    /usr/local/lib/python3/dist-packages/htdocs/plugins \
    /usr/lib/python3.*/dist-packages/htdocs/plugins \
    /usr/local/lib/python3.*/dist-packages/htdocs/plugins \
    /opt/openwebrx/htdocs/plugins \
    /opt/openwebrx+/htdocs/plugins \
    /srv/openwebrx/htdocs/plugins \
    /var/www/openwebrx/htdocs/plugins \
    /opt/owrx-docker/plugins
  do
    [ -d "$p" ] || continue
    if [ -f "$p/receiver/init.js" ] || [ -d "$p/receiver" ]; then
      case ":$schon:" in
        *":$p:"*) ;;
        *) treffer+=("$p"); schon="${schon}:$p" ;;
      esac
    fi
  done
  if [ "${#treffer[@]}" -gt 0 ]; then
    printf '%s\n' "${treffer[@]}"
  fi
}

docker_mount_fuer_container() {
  local c="$1"
  local m=""
  local dst
  for dst in \
    "/usr/lib/python3/dist-packages/htdocs/plugins" \
    "/opt/openwebrx/htdocs/plugins" \
    "/opt/openwebrx+/htdocs/plugins" \
    "/htdocs/plugins"
  do
    m=$(docker inspect "$c" --format "{{range .Mounts}}{{if eq .Destination \"$dst\"}}{{.Source}}{{end}}{{end}}" 2>/dev/null || true)
    if [ -n "$m" ] && [ -d "$m" ]; then
      printf '%s\n' "$m"
      return 0
    fi
  done
  return 1
}

docker_container_plugins_pfad() {
  local c="$1"
  local pfad=""
  pfad=$(docker exec "$c" sh -c '
    for p in \
      /usr/lib/python3/dist-packages/htdocs/plugins \
      /usr/local/lib/python3/dist-packages/htdocs/plugins \
      /opt/openwebrx/htdocs/plugins \
      /opt/openwebrx+/htdocs/plugins \
      /htdocs/plugins
    do
      if [ -d "$p/receiver" ] || [ -f "$p/receiver/init.js" ]; then
        printf "%s\n" "$p"
        exit 0
      fi
    done
    exit 1
  ' 2>/dev/null || true)
  if [ -n "$pfad" ]; then
    printf '%s\n' "$pfad"
    return 0
  fi
  # Fallback auf den OpenWebRX-Standardpfad im Container
  printf '%s\n' "/usr/lib/python3/dist-packages/htdocs/plugins"
}

frage_typ_und_ziel() {
  # 1) Explizite Vorgaben per Umgebungsvariable respektieren
  if [ -n "$PLUGINS_VORGABE" ]; then
    [ -d "$PLUGINS_VORGABE" ] || { echo "FEHLER: Verzeichnis '$PLUGINS_VORGABE' existiert nicht." >&2; exit 1; }
    ZIEL_ART="normal"
    S="$PLUGINS_VORGABE"
    I="$S/receiver/init.js"
    return 0
  fi

  if [ -n "$CONTAINER_VORGABE" ]; then
    TYP_VORGABE="docker"
  fi

  local wahl=""
  if [ -n "$TYP_VORGABE" ]; then
    case "$TYP_VORGABE" in
      normal|1|nativer|baremetal) wahl="1" ;;
      docker|2|container)         wahl="2" ;;
      *) echo "FEHLER: Unbekannter TYP='$TYP_VORGABE' (erlaubt: normal | docker)." >&2; exit 1 ;;
    esac
  else
    echo ""
    echo "====================================================================="
    echo "  DNX HF-Funkgeraete Remote (v1.1.0) – Einrichtung ($CMD)"
    echo "  Enthaelt 3 Allmode-/HF-Funkgeraete inklusive Frontplatten-Bilder"
    echo "====================================================================="
    echo ""
    echo "Welche OpenWebRX-Installation nutzt du?"
    echo "  [1] Normales OpenWebRX / OpenWebRX+ (direkt auf dem System installiert)"
    echo "  [2] Docker-Image / Docker-Container"
    echo ""
    while true; do
      printf "Bitte waehlen [1/2]: "
      read -r wahl || { echo "FEHLER: Eingabe abgebrochen." >&2; exit 1; }
      case "$wahl" in
        1|2) break ;;
        *) echo "Bitte 1 (normales OpenWebRX) oder 2 (Docker) eingeben." ;;
      esac
    done
  fi

  if [ "$wahl" = "1" ]; then
    # --- Normales OpenWebRX ---
    local gefundene=()
    while IFS= read -r line; do
      [ -n "$line" ] && gefundene+=("$line")
    done < <(suche_normal_kandidaten || true)

    local gewaehlt=""
    if [ "${#gefundene[@]}" -eq 1 ]; then
      echo ""
      echo "Gefundenes OpenWebRX-Plugin-Verzeichnis:"
      echo "  ${gefundene[0]}"
      if [ -z "$TYP_VORGABE" ]; then
        printf "Dieses Verzeichnis verwenden? [Enter = Ja, oder eigenen Pfad eingeben]: "
        read -r eing || eing=""
        gewaehlt="${eing:-${gefundene[0]}}"
      else
        gewaehlt="${gefundene[0]}"
      fi
    elif [ "${#gefundene[@]}" -gt 1 ]; then
      echo ""
      echo "Mehrere OpenWebRX-Plugin-Verzeichnisse gefunden:"
      local idx=1
      for g in "${gefundene[@]}"; do
        echo "  [$idx] $g"
        idx=$((idx + 1))
      done
      if [ -z "$TYP_VORGABE" ]; then
        printf "Nummer [1-%d] oder eigenen Pfad eingeben [1]: " "${#gefundene[@]}"
        read -r eing || eing=""
        eing="${eing:-1}"
        if [[ "$eing" =~ ^[0-9]+$ ]] && [ "$eing" -ge 1 ] && [ "$eing" -le "${#gefundene[@]}" ]; then
          gewaehlt="${gefundene[$((eing - 1))]}"
        else
          gewaehlt="$eing"
        fi
      else
        gewaehlt="${gefundene[0]}"
      fi
    else
      echo ""
      echo "Kein Standard-Plugin-Verzeichnis automatisch gefunden."
      printf "Bitte Pfad zum plugins-Verzeichnis eingeben (z. B. /usr/lib/python3/dist-packages/htdocs/plugins): "
      read -r gewaehlt || gewaehlt=""
    fi

    [ -n "$gewaehlt" ] || { echo "FEHLER: Kein Plugin-Verzeichnis angegeben." >&2; exit 1; }
    [ -d "$gewaehlt" ] || { echo "FEHLER: Verzeichnis '$gewaehlt' existiert nicht." >&2; exit 1; }
    if [ ! -d "$gewaehlt/receiver" ] && [ ! -f "$gewaehlt/receiver/init.js" ]; then
      echo "FEHLER: '$gewaehlt/receiver' nicht gefunden. Bitte den Ordner angeben, der 'receiver/' enthaelt." >&2
      exit 1
    fi

    ZIEL_ART="normal"
    S="$gewaehlt"
    I="$S/receiver/init.js"
    echo "  -> Modus: Normales OpenWebRX ($S)"
    return 0
  fi

  # --- Docker-Image / Container ---
  command -v docker >/dev/null 2>&1 || {
    echo "FEHLER: 'docker' wurde auf diesem System nicht gefunden." >&2
    exit 1
  }

  local cname="$CONTAINER_VORGABE"
  if [ -z "$cname" ]; then
    local liste=()
    local line
    while IFS= read -r line; do
      [ -n "$line" ] && liste+=("$line")
    done < <(docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null || true)

    if [ "${#liste[@]}" -eq 0 ]; then
      echo "FEHLER: Keine Docker-Container gefunden. Bitte Container zuerst starten oder anlegen." >&2
      exit 1
    fi

    echo ""
    echo "Vorhandene Docker-Container:"
    local i=1 def_idx=1 names=()
    for line in "${liste[@]}"; do
      local n img st mflag=""
      n="${line%%|*}"
      local rest="${line#*|}"
      img="${rest%%|*}"
      st="${rest#*|}"
      names+=("$n")
      if echo "$n $img" | grep -qiE "owrx|openwebrx"; then
        mflag="  <-- OpenWebRX"
        def_idx="$i"
      fi
      echo "  [$i] $n  ($img | $st)$mflag"
      i=$((i + 1))
    done

    if [ -z "$TYP_VORGABE" ]; then
      printf "Bitte Nummer [1-%d] oder Container-Namen eingeben [%s]: " "${#names[@]}" "$def_idx"
      read -r eing || eing=""
      eing="${eing:-$def_idx}"
      if [[ "$eing" =~ ^[0-9]+$ ]] && [ "$eing" -ge 1 ] && [ "$eing" -le "${#names[@]}" ]; then
        cname="${names[$((eing - 1))]}"
      else
        cname="$eing"
      fi
    else
      cname="${names[$((def_idx - 1))]}"
    fi
  fi

  docker inspect "$cname" >/dev/null 2>&1 || {
    echo "FEHLER: Docker-Container '$cname' nicht gefunden." >&2
    exit 1
  }
  CONT="$cname"

  local mnt=""
  mnt=$(docker_mount_fuer_container "$CONT" || true)
  if [ -n "$mnt" ]; then
    ZIEL_ART="docker-mount"
    S="$mnt"
    I="$S/receiver/init.js"
    echo "  -> Modus: Docker-Container '$CONT' mit Host-Mount ($S)"
  else
    ZIEL_ART="docker-cp"
    C_PLUGINS=$(docker_container_plugins_pfad "$CONT")
    echo "  -> Modus: Docker-Container '$CONT' (ohne Plugins-Volume -> direkt im Image/Container: $C_PLUGINS)"
  fi
}

# --- Loader-Block in einer init.js-Datei einsetzen / entfernen -------
heraus_aus_datei() {
  local datei="$1"
  [ -f "$datei" ] || return 0
  if grep -qF "$MARK_A" "$datei" 2>/dev/null; then
    awk -v a="$MARK_A" -v b="$MARK_B" '
      index($0,a){f=1; if(prev==""){prev=""} next}
      index($0,b){f=0; next}
      f{next}
      { if(prev!="") print prev; prev=$0 }
      END{ if(!f && prev!="") print prev }
    ' "$datei" > "$datei.dnx-neu" && mv -f "$datei.dnx-neu" "$datei"
  fi
  rm -f "$datei.dnx-neu"
}

anfuegen_an_datei() {
  local datei="$1"
  cat >> "$datei" <<'JS'

/* DNX_HF_FUNK_START */
(function(){
  if (document.getElementById("dnx-hf-funk-script")) return;
  var s = document.createElement("script");
  s.id = "dnx-hf-funk-script";
  s.async = false;
  s.src = "static/plugins/receiver/dnx_funkgeraete.js?v=" + Date.now();
  (document.head || document.documentElement).appendChild(s);
})();
/* DNX_HF_FUNK_END */
JS
}

# --- Empfaenger / Container neu starten ------------------------------
neu_starten() {
  if [ "$NORESTART" = "1" ]; then
    echo "  Hinweis: Kein Neustart (NORESTART=1) – im Browser mit Strg+F5 neu laden."
    return 0
  fi

  local soll_neustart="j"
  if [ -t 0 ] && [ -z "$TYP_VORGABE" ] && [ -z "$PLUGINS_VORGABE" ] && [ -z "$CONTAINER_VORGABE" ]; then
    printf "OpenWebRX jetzt neu starten, damit alle Aenderungen sicher greifen? [J/n]: "
    read -r ant || ant="j"
    case "$ant" in
      n|N|nein|NEIN|no|NO) soll_neustart="n" ;;
      *) soll_neustart="j" ;;
    esac
  fi

  if [ "$soll_neustart" = "n" ]; then
    echo "  Kein Neustart ausgefuehrt – bitte im Browser mit Strg+F5 neu laden."
    return 0
  fi

  if [ -n "$CONT" ] && command -v docker >/dev/null 2>&1; then
    echo "  Starte Docker-Container '$CONT' neu..."
    docker restart "$CONT" >/dev/null
    echo "  Container '$CONT' neu gestartet. Bitte kurz warten und Browser neu laden (Strg+F5)."
    return 0
  fi

  if command -v systemctl >/dev/null 2>&1; then
    local d
    for d in openwebrx openwebrx-plus owrx openwebrx@owrx; do
      if systemctl list-unit-files "$d.service" >/dev/null 2>&1; then
        if systemctl restart "$d" >/dev/null 2>&1; then
          echo "  Dienst '$d' neu gestartet. Bitte Browser neu laden (Strg+F5)."
          return 0
        fi
      fi
    done
  fi

  echo "  Hinweis: Kein automatischer Systemdienst erkannt."
  echo "           Falls noetig OpenWebRX von Hand neu starten und Browser mit Strg+F5 laden."
}

# --- Install / Update ------------------------------------------------
do_install() {
  pruefe_root_falls_noetig

  local f
  for f in "${DATEIEN[@]}"; do
    [ -f "$HERE/files/$f" ] || { echo "FEHLER: Paketdatei '$HERE/files/$f' fehlt." >&2; exit 1; }
  done

  frage_typ_und_ziel

  local T bdir vorher="weg"
  T=$(date +%F-%H%M%S)
  bdir="$BACK/$T"
  mkdir -p "$bdir"

  if [ "$ZIEL_ART" = "normal" ] || [ "$ZIEL_ART" = "docker-mount" ]; then
    mkdir -p "$S/receiver"
    if [ -f "$I" ]; then
      cp -a "$I" "$bdir/init.js"
      echo "  Backup: $bdir/init.js"
    else
      echo "/* OpenWebRX Plugin-Loader */" > "$I"
      touch "$bdir/init.js.war-nicht-vorhanden"
      echo "  Neu angelegt: $I"
    fi

    grep -qF "$MARK_A" "$I" 2>/dev/null && vorher="da"
    heraus_aus_datei "$I"

    for f in "${DATEIEN[@]}"; do
      install -m 644 "$HERE/files/$f" "$S/receiver/$f"
      echo "  kopiert: $S/receiver/$f"
    done

    anfuegen_an_datei "$I"
    echo "  Loader eingetragen in: $I"
  else
    # docker-cp (Container ohne Host-Mount auf /plugins)
    local tmpd
    tmpd=$(mktemp -d)
    trap 'rm -rf "$tmpd"' RETURN
    docker exec "$CONT" sh -c "mkdir -p '$C_PLUGINS/receiver'" >/dev/null 2>&1 || true

    if docker cp "$CONT:$C_PLUGINS/receiver/init.js" "$tmpd/init.js" >/dev/null 2>&1; then
      cp -a "$tmpd/init.js" "$bdir/init.js"
      echo "  Backup: $bdir/init.js"
    else
      echo "/* OpenWebRX Plugin-Loader */" > "$tmpd/init.js"
      touch "$bdir/init.js.war-nicht-vorhanden"
      echo "  Neu angelegt im Container: $C_PLUGINS/receiver/init.js"
    fi

    grep -qF "$MARK_A" "$tmpd/init.js" 2>/dev/null && vorher="da"
    heraus_aus_datei "$tmpd/init.js"
    anfuegen_an_datei "$tmpd/init.js"

    for f in "${DATEIEN[@]}"; do
      docker cp "$HERE/files/$f" "$CONT:$C_PLUGINS/receiver/$f"
      echo "  kopiert in Container: $C_PLUGINS/receiver/$f"
    done
    docker cp "$tmpd/init.js" "$CONT:$C_PLUGINS/receiver/init.js"
    docker exec "$CONT" sh -c "chmod 644 '$C_PLUGINS/receiver/init.js' '$C_PLUGINS/receiver/dnx_funkgeraete.js' '$C_PLUGINS/receiver/funkgeraet1_ft710_v8_113.png' '$C_PLUGINS/receiver/funkgeraet2_ts890_v822.png' '$C_PLUGINS/receiver/funkgeraet3_ic7300_v824.png'" >/dev/null 2>&1 || true
    echo "  Loader eingetragen im Container: $C_PLUGINS/receiver/init.js"
  fi

  echo ""
  [ "$vorher" = "da" ] && echo "  (Vorherige Fassung sauber aktualisiert)" || true
  neu_starten
  echo ""
  echo "Fertig: DNX HF-Funkgeraete Remote installiert (inkl. aller 3 HF-Frontplatten-Bilder)."
}

# --- Uninstall -------------------------------------------------------
do_uninstall() {
  pruefe_root_falls_noetig
  frage_typ_und_ziel

  local T bdir f
  T=$(date +%F-%H%M%S)
  bdir="$BACK/$T"
  mkdir -p "$bdir"

  if [ "$ZIEL_ART" = "normal" ] || [ "$ZIEL_ART" = "docker-mount" ]; then
    if [ -f "$I" ]; then
      cp -a "$I" "$bdir/init.js"
      heraus_aus_datei "$I"
      echo "  Backup: $bdir/init.js"
      echo "  Loader entfernt aus: $I"
    fi
    for f in "${DATEIEN[@]}"; do
      if [ -f "$S/receiver/$f" ]; then
        rm -f "$S/receiver/$f"
        echo "  entfernt: $S/receiver/$f"
      fi
    done
  else
    local tmpd
    tmpd=$(mktemp -d)
    trap 'rm -rf "$tmpd"' RETURN
    if docker cp "$CONT:$C_PLUGINS/receiver/init.js" "$tmpd/init.js" >/dev/null 2>&1; then
      cp -a "$tmpd/init.js" "$bdir/init.js"
      heraus_aus_datei "$tmpd/init.js"
      docker cp "$tmpd/init.js" "$CONT:$C_PLUGINS/receiver/init.js"
      echo "  Backup: $bdir/init.js"
      echo "  Loader entfernt im Container: $C_PLUGINS/receiver/init.js"
    fi
    for f in "${DATEIEN[@]}"; do
      docker exec "$CONT" rm -f "$C_PLUGINS/receiver/$f" >/dev/null 2>&1 || true
      echo "  entfernt im Container: $C_PLUGINS/receiver/$f"
    done
  fi

  echo ""
  neu_starten
  echo "Fertig: restlos entfernt."
}

# --- Status ----------------------------------------------------------
do_status() {
  frage_typ_und_ziel
  echo ""
  local f ok=1
  if [ "$ZIEL_ART" = "normal" ] || [ "$ZIEL_ART" = "docker-mount" ]; then
    if [ -f "$I" ] && grep -qF "$MARK_A" "$I" 2>/dev/null; then
      echo "  [OK] Loader aktiv in: $I"
    else
      echo "  [--] Loader fehlt in: $I"
      ok=0
    fi
    for f in "${DATEIEN[@]}"; do
      if [ -f "$S/receiver/$f" ]; then
        echo "  [OK] Datei vorhanden: $S/receiver/$f"
      else
        echo "  [--] Datei fehlt:     $S/receiver/$f"
        ok=0
      fi
    done
  else
    local tmpd
    tmpd=$(mktemp -d)
    trap 'rm -rf "$tmpd"' RETURN
    if docker cp "$CONT:$C_PLUGINS/receiver/init.js" "$tmpd/init.js" >/dev/null 2>&1 && grep -qF "$MARK_A" "$tmpd/init.js" 2>/dev/null; then
      echo "  [OK] Loader aktiv im Container: $C_PLUGINS/receiver/init.js"
    else
      echo "  [--] Loader fehlt im Container: $C_PLUGINS/receiver/init.js"
      ok=0
    fi
    for f in "${DATEIEN[@]}"; do
      if docker exec "$CONT" test -f "$C_PLUGINS/receiver/$f" 2>/dev/null; then
        echo "  [OK] Datei im Container: $C_PLUGINS/receiver/$f"
      else
        echo "  [--] Datei fehlt:        $C_PLUGINS/receiver/$f"
        ok=0
      fi
    done
  fi
  if [ -d "$BACK" ]; then
    echo "  Backups: $(ls -1 "$BACK" | wc -l) Stueck unter $BACK"
  fi
  [ "$ok" -eq 1 ] && echo "Status: vollstaendig installiert." || echo "Status: unvollstaendig / nicht installiert."
}

case "$CMD" in
  install|update) do_install ;;
  uninstall)      do_uninstall ;;
  status)         do_status ;;
  -h|--help|help)
    echo "Benutzung: sudo $0 [install | update | status | uninstall]"
    echo "Optional ohne Rueckfrage:"
    echo "  sudo TYP=normal PLUGINS=/pfad/zu/plugins $0 install"
    echo "  sudo TYP=docker CONTAINER=containername $0 install"
    echo "  sudo NORESTART=1 $0 install"
    ;;
  *)
    echo "FEHLER: Unbekannter Befehl '$CMD' (erlaubt: install | update | status | uninstall)" >&2
    exit 1
    ;;
esac
