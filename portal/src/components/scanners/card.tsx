import { cn, getStatusColor } from "@/lib/utils";

interface ScanCardProps {
  title: string;
  status: string;
  scanCount?: number;
}

export function ScanCard({ title, status, scanCount }: ScanCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <span
          className={cn(
            "px-2 py-1 text-xs font-medium rounded-full",
            getStatusColor(status)
          )}
        >
          {status}
        </span>
      </div>
      {scanCount !== undefined && (
        <p className="mt-2 text-sm text-gray-500">
          {scanCount} scans completed
        </p>
      )}
    </div>
  );
}
