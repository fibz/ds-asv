/** 3px left-edge vertical bar on a row (spec §3.4/§4.1): amber when the finding
 * causes a PCI failure, muted otherwise. Pure visual — always accompanies text
 * markers, never the only signal. */
export function PciBar({ fail }: { fail: boolean }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-[3px]"
      style={{ backgroundColor: fail ? "#F5A524" : "#3D4A66" }}
    />
  );
}
