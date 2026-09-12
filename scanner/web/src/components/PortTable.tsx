import type { PortServiceEvidence } from "../api/types";

/** Open-port table (spec §3.4): mono port / protocol / service / banner / TLS. */
export function PortTable({ ports }: { ports: PortServiceEvidence[] }) {
  if (ports.length === 0) {
    return <p className="py-1 font-mono text-xs text-muted">no open ports recorded</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="dense-table w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="border-b border-edge text-[10px] uppercase text-muted">
            <th className="py-1 pr-3 font-medium">Port</th>
            <th className="py-1 pr-3 font-medium">Proto</th>
            <th className="py-1 pr-3 font-medium">Service</th>
            <th className="py-1 pr-3 font-medium">Banner</th>
            <th className="py-1 pr-3 font-medium">TLS</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p, i) => (
            <tr key={`${p.port}-${p.protocol}-${i}`} className="border-b border-edge/40">
              <td className="py-1 pr-3 text-primary">{p.port}</td>
              <td className="py-1 pr-3 text-muted">{p.protocol}</td>
              <td className="py-1 pr-3 text-muted">{p.service}</td>
              <td className="py-1 pr-3 text-muted">{p.banner ?? "—"}</td>
              <td className="py-1 pr-3 text-muted">
                {p.tls_version ?? (p.cipher_strength ? p.cipher_strength : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
