import Link from "next/link";
import type { CustomerHomeView } from "@/lib/customer/home";

export function customerHomeCards(view: CustomerHomeView) {
  return [
    { label: "Active assets", value: String(view.assets.total), href: "/customer/assets" },
    { label: "Verified assets", value: String(view.assets.verified), href: "/customer/assets?lifecycleState=active" },
    { label: "Scans", value: String(view.scans.total), href: "/customer/scans" },
    { label: "Reports", value: String(view.reports.total), href: "/customer/reports" },
  ];
}

export function CustomerHome({ view }: { view: CustomerHomeView }) {
  const cards = customerHomeCards(view);
  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-bold text-gray-900">{view.organization.name}</h1><p className="text-gray-600">Customer Center</p>{view.organization.parentName && <p className="text-sm text-gray-500">Managed by {view.organization.parentName}</p>}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{cards.map((card) => <Link key={card.label} href={card.href} className="bg-white rounded-lg shadow border border-gray-200 p-6 hover:border-indigo-300"><p className="text-sm text-gray-500">{card.label}</p><p className="mt-2 text-3xl font-semibold text-gray-900">{card.value}</p></Link>)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="bg-white rounded-lg shadow border border-gray-200 p-6"><h2 className="text-lg font-semibold text-gray-900 mb-4">Latest scan</h2>{view.scans.latest ? <div><p className="font-medium text-gray-900">{view.scans.latest.name}</p><p className="text-sm text-gray-600">{view.scans.latest.status} · {new Date(view.scans.latest.createdAt).toLocaleString()}</p></div> : <div><p className="text-sm text-gray-500">No scans yet.</p><Link className="text-sm text-indigo-600 hover:underline" href="/customer/scans">Set up your first scan</Link></div>}</div><div className="bg-white rounded-lg shadow border border-gray-200 p-6"><h2 className="text-lg font-semibold text-gray-900 mb-4">Latest report</h2>{view.reports.latest ? <div><Link className="font-medium text-indigo-600 hover:underline" href={`/customer/reports/${view.reports.latest.id}`}>{view.reports.latest.status.toUpperCase()}</Link><p className="text-sm text-gray-600">{view.reports.latest.isFinal ? "FINAL — attested and scope-approved" : "Not final — attestation and approved scope are both required"}</p></div> : <div><p className="text-sm text-gray-500">No reports yet.</p><Link className="text-sm text-indigo-600 hover:underline" href="/customer/scans">Run a scan to generate a report</Link></div>}</div></div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6"><h2 className="text-lg font-semibold text-gray-900 mb-4">Recent activity</h2>{view.activity.length === 0 ? <p className="text-sm text-gray-500">No organization activity yet.</p> : <ul className="space-y-2 text-sm">{view.activity.map((event) => <li key={event.id} className="flex items-center justify-between"><span className="text-gray-700">{event.action} <span className="text-gray-400">({event.resourceType})</span></span><span className="text-gray-500">{new Date(event.createdAt).toLocaleString()}</span></li>)}</ul>}</div>
      <div className="flex flex-wrap gap-3"><Link href="/customer/assets" className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm">Manage assets</Link><Link href="/customer/scope" className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm">Review scope</Link><Link href="/customer/reports" className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm">View reports</Link></div>
    </div>
  );
}
