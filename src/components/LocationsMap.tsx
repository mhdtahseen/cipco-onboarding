"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { ACTION_COLOR, type GeoPoint } from "@/lib/geoPoints";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// OpenStreetMap map of where entries were made. Markers are grouped when close together; the selected entry is zoomed to and its popup opened; an optional line joins one
// person's points in time order. Every piece of text from the database goes through esc() before it is put in a popup.
export default function LocationsMap({ points, selectedId, onSelect, path }: { points: GeoPoint[]; selectedId: string | null; onSelect: (id: string) => void; path: GeoPoint[] }) {
  const box = useRef<HTMLDivElement>(null); const map = useRef<L.Map | null>(null); const cluster = useRef<L.MarkerClusterGroup | null>(null); const line = useRef<L.Polyline | null>(null); const ring = useRef<L.Circle | null>(null);
  const markers = useRef<Map<string, L.CircleMarker>>(new Map()); const pick = useRef(onSelect); pick.current = onSelect;

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true }).setView([22.5, 79], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    cluster.current = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false }).addTo(m); map.current = m;
    return () => { m.remove(); map.current = null; cluster.current = null; markers.current.clear(); };
  }, []);

  useEffect(() => {
    const m = map.current, c = cluster.current; if (!m || !c) return;
    c.clearLayers(); markers.current.clear();
    points.forEach((p) => {
      const mk = L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: ACTION_COLOR[p.action] ?? "#475569", fillOpacity: 0.95 });
      mk.bindPopup(`<b>${esc(p.who)}</b> <span style="color:#64748b">· ${esc(p.role.replace("_", " "))}</span><br>${esc(p.project)}<br>${esc(p.action)}${p.subject ? ` · ${esc(p.subject)}` : ""}<br><span style="color:#64748b">${esc(when(p.at))}${p.acc != null ? ` · ±${Math.round(p.acc)} m` : ""}</span>`);
      mk.on("click", () => pick.current(p.id)); markers.current.set(p.id, mk); c.addLayer(mk);
    });
    if (points.length) m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 16 });
  }, [points]);

  useEffect(() => {
    const m = map.current; if (!m) return; line.current?.remove(); line.current = null;
    if (path.length > 1) line.current = L.polyline(path.map((p) => [p.lat, p.lng] as [number, number]), { color: "#1d4ed8", weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(m);
  }, [path]);

  useEffect(() => {
    const m = map.current, c = cluster.current; ring.current?.remove(); ring.current = null; if (!m || !c || !selectedId) return;
    const mk = markers.current.get(selectedId), p = points.find((x) => x.id === selectedId); if (!mk || !p) return;
    if (p.acc != null) ring.current = L.circle([p.lat, p.lng], { radius: p.acc, color: "#2563eb", weight: 1, fillOpacity: 0.08 }).addTo(m);
    c.zoomToShowLayer(mk, () => mk.openPopup());
  }, [selectedId, points]);

  return <div ref={box} className="h-[55vh] min-h-[22rem] w-full rounded-xl border border-slate-200 z-0" aria-label="Map of where entries were made" />;
}
