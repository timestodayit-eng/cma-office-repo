# নতুন VPS-এ CMA Office + আরও সাইট

একটা নতুন Ubuntu VPS (২ GB RAM বা বেশি)-এ পুরো CMA Office বসানো, নিজের ডোমেইনে HTTPS সহ।
একই VPS-এ আরও যত খুশি সাইট চালানো যাবে: সবার সামনে একটাই "proxy" (Caddy) থাকে, সেটা প্রতিটা ডোমেইনের জন্য নিজে থেকে ফ্রি HTTPS সার্টিফিকেট নেয়।

```
ইন্টারনেট ──► VPS (80/443) ──► proxy (Caddy) ──┬─► office.yourdomain.com  → CMA Office
                                                ├─► shop.yourdomain.com    → অন্য সাইট
                                                └─► yourdomain.com         → সাধারণ HTML সাইট
```

## ধাপ ০: ডোমেইনের DNS

ডোমেইন যেখান থেকে কেনা (Hostinger, Namecheap, Cloudflare...), সেখানে DNS-এ একটা **A record** দিন:

| Type | Name | Value |
| --- | --- | --- |
| A | `office` (বা `@` মূল ডোমেইনের জন্য) | নতুন VPS-এর IP |

প্রতিটা সাইটের জন্য একটা করে A record, সবগুলো একই IP-তে। Cloudflare হলে প্রথমে মেঘ (proxy) বন্ধ রাখুন (DNS only)।

## ধাপ ১ (শুধু পুরনো ডেটা আনতে চাইলে): পুরনো সার্ভার থেকে ব্যাকআপ

**পুরনো** সার্ভারে:

```bash
cd ~/cma-office
docker compose exec -T db pg_dump -U cma cma | gzip > ~/cma-backup.sql.gz
scp ~/cma-backup.sql.gz root@নতুন-VPS-IP:/root/
```

## ধাপ ২: নতুন VPS-এ ইনস্টল

**নতুন** VPS-এ SSH দিয়ে ঢুকে (`ssh root@নতুন-VPS-IP`):

```bash
curl -fsSL https://raw.githubusercontent.com/timestodayit-eng/cma-office-repo/phase-1-backend-web/install.sh -o install.sh

# নতুন খালি সিস্টেম:
sudo sh install.sh office.yourdomain.com

# অথবা পুরনো ডেটা সহ:
sudo sh install.sh office.yourdomain.com /root/cma-backup.sql.gz
```

স্ক্রিপ্ট নিজেই Docker বসায়, proxy চালু করে, নতুন পাসওয়ার্ড দিয়ে `.env` বানায়, অ্যাপ বিল্ড করে (প্রথমবার ৫-১০ মিনিট) আর ডোমেইন যোগ করে।
শেষ হলে `https://office.yourdomain.com` খুলুন।

WhatsApp বা OpenAI key থাকলে: `nano ~/cma-office/.env` এ বসিয়ে `cd ~/cma-office && sh update.sh`।
(পুরনো সার্ভারের `.env` থেকে `WHATSAPP_*` আর `OPENAI_API_KEY` কপি করা যায়।)

## ধাপ ৩: নতুন ঠিকানায় সব কিছু জোড়া

- **Google Sheets**: অ্যাপে Settings → Google Sheets connection → প্রতিটা শিটের "Copy script" আবার কপি করে শিটের Apps Script-এ পুরনোটার জায়গায় বসান (স্ক্রিপ্টে নতুন ঠিকানা আছে)। Deploy আবার করুন।
- **মোবাইল অ্যাপ / ডেস্কটপ অ্যাপ**: নতুন করে বানাতে হবে না। অ্যাপে সার্ভার ঠিকানা বদলে `https://office.yourdomain.com` দিন।
- পুরনো সার্ভার বন্ধ করুন শুধু সব ঠিক চলছে দেখার পর: `cd ~/cma-office && docker compose down` (ডেটা মোছে না)।

## আরও সাইট যোগ করা

```bash
sh ~/proxy/add-site.sh <ডোমেইন> <কোথায়>
```

| সাইট কী ধরনের | কমান্ড |
| --- | --- |
| সাধারণ HTML/ওয়েবসাইট ফাইল | `sh ~/proxy/add-site.sh yourdomain.com static` তারপর ফাইল রাখুন `~/proxy/www/yourdomain.com/` এ |
| Docker-এ চলা অ্যাপ | অ্যাপের compose-এ `networks: [web]` (external) দিন, তারপর `sh ~/proxy/add-site.sh shop.yourdomain.com <container-নাম>:<port>` |
| VPS-এ সরাসরি চলা প্রোগ্রাম (Node, PHP...) | `sh ~/proxy/add-site.sh app.yourdomain.com localhost:8080` (প্রোগ্রামকে `0.0.0.0:8080`-এ শুনতে হবে) |
| www → মূল ডোমেইন | `sh ~/proxy/add-site.sh www.yourdomain.com redirect:https://yourdomain.com` |

সাইট সরাতে: `sh ~/proxy/remove-site.sh <ডোমেইন>`। সব সাইটের তালিকা: `ls ~/proxy/sites`।

Docker অ্যাপকে `web` নেটওয়ার্কে জোড়ার উদাহরণ (অ্যাপের `docker-compose.yml`):

```yaml
services:
  app:
    image: ...
    networks: [web]        # ports: লাগবে না, proxy ভেতর দিয়ে ঢোকে
networks:
  web:
    external: true
```

## দৈনন্দিন

| কাজ | কমান্ড |
| --- | --- |
| CMA Office আপডেট | `cd ~/cma-office && sh update.sh` |
| লগ দেখা | `cd ~/cma-office && docker compose logs -f web` |
| proxy-র লগ (HTTPS সমস্যা) | `docker logs -f proxy` |
| ডেটাবেস ব্যাকআপ | প্রতিদিন নিজে থেকে `~/cma-office/backups/` এ হয় (১৪ দিন রাখে) |

HTTPS না এলে: DNS ঠিক IP-তে যাচ্ছে কিনা দেখুন (`ping office.yourdomain.com`), আর VPS-এর firewall-এ 80 ও 443 খোলা কিনা (`ufw allow 80,443/tcp`)।
