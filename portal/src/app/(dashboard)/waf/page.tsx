export default function WafPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WAF</h1>
        <p className="text-gray-600">Web Application Firewall configuration and monitoring</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Total Requests</h3>
          <p className="text-3xl font-bold text-indigo-600 mt-2">1.2M</p>
          <p className="text-sm text-gray-500 mt-1">Last 24 hours</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Blocked Requests</h3>
          <p className="text-3xl font-bold text-red-600 mt-2">3,421</p>
          <p className="text-sm text-gray-500 mt-1">0.28% of total</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Active Rules</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">47</p>
          <p className="text-sm text-gray-500 mt-1">12 custom rules</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">WAF Rules</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <div>
                <p className="font-medium text-gray-900">SQL Injection Protection</p>
                <p className="text-sm text-gray-500">Block SQL injection attempts</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                ENABLED
              </span>
              <button className="text-sm text-indigo-600 hover:text-indigo-800">Edit</button>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <div>
                <p className="font-medium text-gray-900">XSS Protection</p>
                <p className="text-sm text-gray-500">Block cross-site scripting</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                ENABLED
              </span>
              <button className="text-sm text-indigo-600 hover:text-indigo-800">Edit</button>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div>
                <p className="font-medium text-gray-900">Rate Limiting</p>
                <p className="text-sm text-gray-500">Limit requests per IP</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
                CUSTOM
              </span>
              <button className="text-sm text-indigo-600 hover:text-indigo-800">Edit</button>
            </div>
          </div>
        </div>
        <button className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
          Add Rule
        </button>
      </div>
    </div>
  );
}
