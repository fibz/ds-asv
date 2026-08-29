export default function CompliancePage() {
  const frameworks = [
    { name: "SOC 2", version: "2017", score: 85 },
    { name: "PCI DSS", version: "4.0", score: 72 },
    { name: "PCI SSS", version: "1.0", score: 45 },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
        <p className="text-gray-600">Monitor your compliance status across frameworks</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {frameworks.map((framework) => (
          <div key={framework.name} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900">{framework.name}</h3>
            <p className="text-sm text-gray-500">Version {framework.version}</p>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Compliance Score</span>
                <span className="text-sm font-bold text-gray-900">{framework.score}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    framework.score >= 80
                      ? "bg-green-500"
                      : framework.score >= 60
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                  style={{ width: `${framework.score}%` }}
                />
              </div>
            </div>
            <button className="mt-4 w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
              View Details
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Audit Logs</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">PCI DSS Control 1.1 - Network Security</p>
              <p className="text-sm text-gray-500">Checked 2 hours ago</p>
            </div>
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
              COMPLIANT
            </span>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">SOC 2 CC3.1 - Risk Assessment</p>
              <p className="text-sm text-gray-500">Checked 5 hours ago</p>
            </div>
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
              IN_PROGRESS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
