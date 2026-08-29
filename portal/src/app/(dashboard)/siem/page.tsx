export default function SiemPage() {
  const alerts = [
    {
      id: "1",
      severity: "HIGH",
      title: "Suspicious login attempt",
      source: "Wazuh",
      time: "5 minutes ago",
      resolved: false,
    },
    {
      id: "2",
      severity: "MEDIUM",
      title: "Failed authentication",
      source: "Custom",
      time: "1 hour ago",
      resolved: false,
    },
    {
      id: "3",
      severity: "LOW",
      title: "Configuration change",
      source: "Wazuh",
      time: "3 hours ago",
      resolved: true,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">SIEM</h1>
        <p className="text-gray-600">Security monitoring with Wazuh integration</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Total Alerts</h3>
          <p className="text-3xl font-bold text-indigo-600 mt-2">156</p>
          <p className="text-sm text-gray-500 mt-1">Last 24 hours</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Critical</h3>
          <p className="text-3xl font-bold text-red-600 mt-2">3</p>
          <p className="text-sm text-gray-500 mt-1">Require attention</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">High</h3>
          <p className="text-3xl font-bold text-orange-600 mt-2">12</p>
          <p className="text-sm text-gray-500 mt-1">Pending review</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Resolved</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">141</p>
          <p className="text-sm text-gray-500 mt-1">Last 24 hours</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Alerts</h2>
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-3 h-3 rounded-full ${
                    alert.severity === "HIGH"
                      ? "bg-red-500"
                      : alert.severity === "MEDIUM"
                      ? "bg-orange-500"
                      : "bg-yellow-500"
                  }`}
                />
                <div>
                  <p className="font-medium text-gray-900">{alert.title}</p>
                  <p className="text-sm text-gray-500">
                    {alert.source} • {alert.time}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                    alert.severity === "HIGH"
                      ? "bg-red-100 text-red-800"
                      : alert.severity === "MEDIUM"
                      ? "bg-orange-100 text-orange-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {alert.severity}
                </span>
                {!alert.resolved && (
                  <button className="text-sm text-indigo-600 hover:text-indigo-800">
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
