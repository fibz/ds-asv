"use client";

import { useState } from "react";

export default function ScannersPage() {
  const [target, setTarget] = useState("");
  const [scanType, setScanType] = useState("ASV");

  const handleScan = async () => {
    // TODO: Call API to start scan
    console.log("Starting scan:", { target, type: scanType });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scanners</h1>
        <p className="text-gray-600">Run vulnerability scans with T3MP3ST integration</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Start New Scan</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Target</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="IP address or URL"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Scan Type</label>
            <select
              value={scanType}
              onChange={(e) => setScanType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ASV">ASV Scan</option>
              <option value="VULNERABILITY">Vulnerability Scan</option>
              <option value="COMPLIANCE">Compliance Scan</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleScan}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              Start Scan
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Scans</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">192.168.1.1 - ASV Scan</p>
              <p className="text-sm text-gray-500">Completed 2 hours ago</p>
            </div>
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
              COMPLETED
            </span>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">example.com - Vulnerability Scan</p>
              <p className="text-sm text-gray-500">Running for 15 minutes</p>
            </div>
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
              RUNNING
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
