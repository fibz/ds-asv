import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center">
          <h1 className="text-5xl font-extrabold text-white sm:text-6xl md:text-7xl">
            Compliance Engine
          </h1>
          <p className="mt-6 text-xl text-indigo-100 max-w-2xl mx-auto">
            ASV Scanner, Wazuh SIEM, WAF & Payment Engine Compliance Platform
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/sign-in"
              className="px-8 py-3 bg-white text-indigo-600 font-semibold rounded-lg shadow-lg hover:bg-indigo-50 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="px-8 py-3 border-2 border-white text-white font-semibold rounded-lg hover:bg-white/10 transition-colors"
            >
              Get Started
            </Link>
          </div>
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white">ASV Scanning</h3>
              <p className="mt-2 text-indigo-100">
                Automated vulnerability scanning with T3MP3ST integration
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white">Wazuh SIEM</h3>
              <p className="mt-2 text-indigo-100">
                Real-time security monitoring and alert correlation
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white">WAF Protection</h3>
              <p className="mt-2 text-indigo-100">
                Web Application Firewall for payment engine protection
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
