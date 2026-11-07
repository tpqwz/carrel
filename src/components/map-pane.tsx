import { useEffect, useRef } from "react";
import type { Layer, Map as LeafletMap } from "leaflet";

export type MapPoint = {
  lat: number;
  lon: number;
  title: string;
  detail: string;
};

export function MapPane({ points }: { points: MapPoint[] }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !host.current) return;

      mapRef.current?.remove();
      const map = L.map(host.current, {
        scrollWheelZoom: true,
        attributionControl: true,
      }).setView([20, 10], 2);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      const group: Layer[] = points.map((point) =>
        L.circleMarker([point.lat, point.lon], {
          radius: 7,
          color: "#1c1814",
          weight: 1,
          fillColor: "#b45309",
          fillOpacity: 0.9,
        }).bindPopup(`<strong>${escapeHtml(point.title)}</strong><br/>${escapeHtml(point.detail)}`),
      );
      if (group.length) {
        const bounds = L.featureGroup(group).addTo(map);
        map.fitBounds(bounds.getBounds().pad(0.3));
      }
      mapRef.current = map;
      window.setTimeout(() => map.invalidateSize(), 50);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points]);

  return <div ref={host} className="h-96 w-full overflow-hidden rounded-card bg-stamp-soft" />;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u003c")
    .replaceAll(">", "\u003e")
    .replaceAll('"', "\u0026quot;");
}
