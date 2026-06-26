---
title: "My Server Got Hit by Two Different Hackers at the Same Time... Here's How I Got It Back"
tag: "cybersecurity"
publishDate: "May 27 2026"
updatedDate: "Jun 26 2026"
heroImage: "../../images/hacker.jpeg"
heroImageAlt: "A hacker with a mask on looking intimidating towards the screen"
---
##### A war story about cryptominers, ransomware, a broken bootloader, and a very long day at the console

There's a specific kind of dread that hits when you try to SSH into a server and get nothing back. No timeout, no refused connection — just silence. You ping it. Nothing. You pull up the Hyper-V console expecting to see a login prompt, and instead you're looking at a GRUB command line.

That was my morning on May 27th, 2026.

What followed was a several-hour deep dive through initramfs shells, LVM activation, manual GRUB boot sequences, and ultimately the discovery that the server had been compromised — twice — by two completely separate threat actors. One was quietly mining Monero in the background. The other had dropped ransomware and encrypted the backups.

This is the full story of what I found, how I got in, and what I cleaned up.

<hr />

## First: What Even Is a cPanel Server?

For the non-technical folks — the server in question runs __cPanel/WHM__, which is a web hosting control panel. Think of it as the software layer that lets you manage multiple websites, email accounts, and databases from one place. It's extremely common on shared hosting infrastructure and managed hosting environments. Our instance was hosting several WordPress sites across multiple client accounts.

The OS underneath was __Rocky Linux 8__, a Red Hat-compatible Linux distribution — running on a VM with about 370GB of storage spread across two disks and an LVM (Logical Volume Manager) setup. LVM is a flexible disk management layer that sits between the physical disks and the filesystems. This detail becomes very important later.

## The First Clue: GRUB

When I pulled up the console, I wasn't looking at a login prompt. I was looking at this:

``` bash
grub >
```

That's the raw GRUB command line — meaning the bootloader loaded, but couldn't find its configuration file to present the normal boot menu. Something had broken between GRUB and the rest of the system.

My first thought was disk failure. My second thought, after poking around, was something more sinister.

To boot the system manually from the GRUB prompt, I had to load the right modules, find the kernel on the boot partition, and kick it off by hand:

``` grub
insmod lvm
insmod xfs
linux (hd0,1)/vmlinuz-4.18.0-425.3.1.el8.x86_64
initrd (hd0,1)/initramfs-4.18.0-425.3.1.el8.x86_64.img
boot
```

This got me into the system — but not cleanly. The server kept dropping into a dracut emergency shell, which is a minimal recovery environment that loads when Linux can't complete its boot sequence. Among other things, it's missing most of the tools you'd normally use, including `passwd`, `openssl`, and in this case, even `lvm`.

The root password had been changed. I couldn't log in normally. And the attacker had made sure cleanup wouldn't be easy.

<hr />

## Getting Root Back

The goal was simple: reset the root password without being able to log in as root.

The approach: mount the real filesystem and edit `/etc/shadow` directly. Shadow is the file Linux uses to store password hashes. If you can write to it, you can blank the root password and log in without one.

The complication: the root filesystem was on an LVM logical volume, and the initramfs environment I was stuck in didn't have LVM tools. Every time I tried `lvm vgscan`, I got back `lvm: command not found`.

After a lot of trial and error — trying different module loads, different tools, different approaches — I found a rescue image sitting in `/boot` from a previous setup. Booting that gave me a proper environment with LVM support.

With LVM tools available, the sequence to get the real filesystem mounted looked like this:

``` bash
lvm vgscan
lvm vgchange -ay
lvm vgmknodes
mount -t xfs /dev/mapper/rl_web--ck1-root /sysroot
```

Once mounted, blanking the root password was a single sed command:

`sed -i 's/^root:[^:]*:/root::/' /sysroot/etc/shadow`

That replaces the password hash with nothing — empty string means no password required. After rebooting and logging in, I set a real password immediately with `passwd root`.

We were in. Now to figure out what actually happened.

<hr />

## What I Found: Threat Actor One — The Cryptominer

The first thing I did after getting a shell was look for unusual services and files.

``` bash
systemctl list-units --failed
find /usr/share/zoneinfo -type d
ls /etc/systemd/system/dbus*
```

There it was. A directory sitting inside `/usr/share/zoneinfo` — a legitimate system path that stores timezone data and is almost never looked at — called `.dbus`. Inside:

``` bash
/usr/share/zoneinfo/.dbus/dbus-daemon-service
/usr/share/zoneinfo/.dbus/config.env
/usr/share/zoneinfo/.dbus/dbus-monitor.sh
```

The binary was named `dbus-daemon-service` — designed to look like a legitimate D-Bus system process to anyone quickly scanning process lists. D-Bus is a real Linux inter-process communication system, and `dbus-daemon` is a real process. The naming was deliberate.

The systemd service file at `/etc/systemd/system/dbus-system-monitor.service` told the full story. On startup, it would download a fresh binary from a remote server (`155.117.232.235`), then launch it as an __XMRig Monero miner__ pointed at `pool.supportxmr.com` and `auto.c3pool.org`.

XMRig is legitimate open-source mining software — it's what attackers use because it's reliable and configurable. The wallet address it was mining to:

``` bash
85JjCZjQzVCcyjjzRtBhW4JnRYSsTTpKz2mWnvW5AAnhfftbshoaEfpix2zmE12HfhYcrkj4G6E5oNV5r8oegFwa2u1SBUg
```

The wallet address itself was stored on Pastebin (`pastebin.com/raw/nzJRS1tm`) so the attacker could swap it out remotely without touching the server again.

A companion service — `dbus-cleanup.timer` — ran every 60 seconds and did a few things: it killed any process using more than 60% CPU that wasn't on a whitelist (evicting other miners that might compete for resources), removed any firewall rules blocking the C2 server, and pulled the latest wallet address from Pastebin in case it had been updated.

The miner also hid itself from `/proc` — the Linux virtual filesystem that exposes running process information — using a `mount --bind` trick that effectively made the miner's process directory invisible to tools like `top` and `ps`.

Other persistence mechanisms included:

- An __SSH backdoor key__ injected into `/root/.ssh/authorized_keys`, made immutable with `chattr +i` so it couldn't be removed without first unlocking it
- An additional __SSH port (8882)__ added to `/etc/ssh/sshd_config` for a second entry point
- An __infection beacon__ that phoned home to `webhook.site` to notify the attacker of a successful install
- Shell history suppression (`HISTSIZE=0`, `HISTFILE=/dev/null`) so the install script left no trace in bash history

The script deleted itself after running (`rm -f $0`). Professional enough to cover its tracks, but not professional enough to avoid leaving the entire malware directory in place.

## What I Found: Threat Actor Two — The Ransomware

Here's where it got interesting in the worst way.

While investigating the boot failure, I'd noticed that the GRUB configuration file had been renamed:

``` bash
/boot/grub2/grub.cfg.sorry
```

I assumed this was some kind of failed update artifact. It wasn't.

Searching the filesystem:

``` bash
find / -name "README.md" | xargs grep -l "qtox" 2>/dev/null
```

Ransom notes. Everywhere.

``` bash
Please contact us through the qtox tool

Download qtox https://github.com/qTox/qTox/blob/master/README.md#qtox

If you can't contact us, please contact some data recovery company
(suggest taobao.com), may they can contact us.

Add our TOX ID and send an encrypted file and 'Sorry-ID' for testing decryption.

Our TOX ID: 3D7889AEC00F2325E1A3FBC0ACA4E521670497F11E47FDE13EADE8FED3144B5EB56D6B19B724
```

This is the __SORRY ransomware__ — a Linux variant that appends `.sorry` to encrypted files and uses the TOX encrypted messaging network for victim contact. The ransom note was sitting in `/root`, in `/tmp`, in `.spamassassin`, and in a dozen other directories.

The damage assessment:

__Destroyed:__ Six dates of backups in `/backups/` — December 8, 9, 10, 11, 15, and 18, 2024. Both the accounts and system backup sets for each date. Gone.

__Corrupted:__ The GRUB config file (which is what broke the boot), cPanel system data for several accounts, DNS zone files, Imunify360 data.

__Intact:__ MySQL databases for all WordPress installations appeared unaffected. The core OS survived. The home directories of hosted accounts still need a full audit.

The encrypted backups are the most painful part. They were the only copies.

<hr />

## The Boot Problem Was Actually the Ransomware

This is the thing that took a while to connect: __the reason the server wouldn't boot was the ransomware, not the cryptominer.__

The SORRY ransomware had encrypted or renamed `grub.cfg` — the file GRUB needs to know what kernel to load and with what parameters. Without it, GRUB dropped to the command line. Without a working boot, we couldn't log in. Without logging in, we couldn't clean anything up.

The cryptominer had been running happily underneath all of this. Two separate attackers, two separate toolkits, one very broken server.

The fix for the boot issue, after all the LVM gymnastics, was rebuilding the initramfs with LVM support baked in (it wasn't, which is why the default boot kept failing), reinstalling GRUB to the correct disk, and regenerating the config:

``` bash
dracut --force --add "lvm" /boot/initramfs-4.18.0-425.3.1.el8.x86_64.img 4.18.0-425.3.1.el8.x86_64
grub2-install /dev/sda
grub2-mkconfig -o /boot/grub2/grub.cfg
```

One gotcha: the system has two disks. We'd been installing GRUB to the wrong one for several attempts. `device.map` confirmed (`hd0`) mapped to `/dev/sda`, which is where the BIOS was looking, but the LVM with the actual root volume lived on `/dev/sdb`. Once that was sorted, the boot sequence worked.

<hr />

## Cleanup

With root access restored and the system booting, cleanup was methodical:

``` bash
# Remove the attacker's SSH key (had to unlock it first)
chattr -i /root/.ssh
rm /root/.ssh/authorized_keys

# Stop and remove the miner services
systemctl stop dbus-system-monitor.service dbus-cleanup.timer
systemctl disable dbus-system-monitor.service dbus-cleanup.timer
rm -rf /usr/share/zoneinfo/.dbus
rm -f /etc/systemd/system/dbus-system-monitor.service
rm -f /etc/systemd/system/dbus-cleanup.service
rm -f /etc/systemd/system/dbus-cleanup.timer
systemctl daemon-reload

# Remove the backdoor SSH port
sed -i '/Port 8882/d' /etc/ssh/sshd_config
systemctl restart sshd

# Flush the attacker's iptables rules
iptables -F && iptables -P INPUT ACCEPT
```

The miner service came back clean — `systemctl status dbus-system-monitor.service` returned "could not be found." The malware directory was gone. No outbound connections to `155.117.232.235`. No process named `dbus-daemon-service` in the process list.

Network connectivity had also dropped during all of this — the interface was in a `linkdown` state, likely from the system spending so long in emergency/recovery mode. A quick `ip link set eth0 up` and NetworkManager restart brought it back.

<hr />

## How Did This Happen?

Honest answer: I don't know the exact initial access vector yet, and probably won't without full log forensics. But the likely candidates are:

__SSH brute force.__ Root login with password authentication was almost certainly enabled. This is one of the most common initial access methods for Linux server compromises. Attackers run automated tools that hammer SSH endpoints looking for weak or reused passwords.

__Compromised cPanel credentials.__ WHM admin access would give an attacker everything they need. Credentials get leaked, phished, or stuffed from other breaches constantly.

__The presence of two attackers__ is itself a clue. Initial server access is frequently sold on underground markets once it's established. The cryptominer operator may have sold or shared access, and the ransomware operator came in separately. Or the ransomware came first, and the miner operator found the same opening independently.

Either way, the contributing factors are clear: no offsite backup, root SSH with password auth, Imunify360 that either wasn't configured properly or was bypassed before it could alert, and no external monitoring that would have caught outbound mining pool traffic.

<hr />

## What's Next

The immediate priorities:

- __Full ransomware scope audit__ — `find / -name '*.sorry'` to enumerate everything that was hit

- __Webshell hunt__ — `find /home -name '*.php' -newer /etc/passwd` across all hosted accounts

- __WordPress credential rotation__ — every admin account across every site

- __Offsite Backups__  — this should have existed already. It will now.

- __Disable root SSH password login__  — `PermitRootLogin prohibit-password`

The longer-term conversation is about whether to do a full OS reinstall. The honest answer is yes, that's the right call after a root-level compromise this deep. A clean rebuild from a known-good state is the only way to be certain nothing was left behind. Whether the business constraints allow for that is a separate question.

<hr />

## Takeaways

A few things worth calling out for anyone running infrastructure:

__Backups stored on the same server as the data are not backups.__ They're a convenience copy. The ransomware went straight for `/backups/` and destroyed six weeks of archives. Offsite, immutable, versioned storage — S3, Backblaze B2, whatever — this is non-negotiable.

__Attackers name their malware after real system processes on purpose.__ `dbus-daemon-service` looks completely plausible in a process list. The location — `/usr/share/zoneinfo/.dbus` — is equally subtle. If you're doing a quick scan for suspicious processes, you'd probably miss it. Regular audits of running services and systemd units catch this.

__Two attackers, one server.__ This is more common than people think. Once a server is compromised, the access can be sold, shared, or discovered independently. You might think you've cleaned up one infection and missed the other entirely.

__Imunify360 being installed is not the same as Imunify360 working.__ Security tools require proper configuration and monitoring. A dashboard you never look at doesn't protect you.

The server is back up. The work isn't done. But we got there.

<hr />

If you're dealing with a similar situation and want to talk through it, feel free to reach out. The full IOC list and recovery commands are in the companion post-mortem document.
