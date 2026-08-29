#!/bin/bash
# Setup ASV scanner read-only account on Linux targets.
# Run as root.

set -euo pipefail

USERNAME="asvscan"
SHELL_PATH="/usr/local/bin/asv-restricted-shell"

if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s "$SHELL_PATH" -c "ASV Scanner Account" "$USERNAME"
fi

mkdir -p /home/$USERNAME/.ssh
touch /home/$USERNAME/.ssh/authorized_keys
chmod 700 /home/$USERNAME/.ssh
chmod 600 /home/$USERNAME/.ssh/authorized_keys
chown -R $USERNAME:$USERNAME /home/$USERNAME/.ssh

cp "$(dirname "$0")/asv-restricted-shell" "$SHELL_PATH"
chmod 755 "$SHELL_PATH"

cat > /etc/ssh/sshd_config.d/90-asv-restricted.conf << 'SSHEOF'
Match User asvscan
    ForceCommand /usr/local/bin/asv-restricted-shell
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
    PermitUserEnvironment no
    MaxSessions 2
SSHEOF

systemctl reload sshd

echo "ASV scanner account '$USERNAME' created."
echo "Next steps:"
echo "  1. Add ASV CA public key to /etc/ssh/asv_ca.pub (for dynamic certs)"
echo "  2. Add static SSH key to /home/$USERNAME/.ssh/authorized_keys"
echo "  3. Test: ssh -i asv_key $USERNAME@thishost 'cat /etc/os-release'"
