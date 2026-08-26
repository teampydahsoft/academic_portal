# Lightsail CI/CD setup

Production host (current): `http://13.204.83.221`  
Repo: `https://github.com/teampydahsoft/academic_portal`

CI/CD deploys on every push to `main` (and manual **Run workflow**).

## What runs automatically

1. GitHub Actions checks out the repo  
2. `rsync` syncs code to `~/academic-portal` on Lightsail (keeps server `.env` files)  
3. SSH runs `scripts/deploy.sh` → npm install, frontend build, PM2 restart  

## One-time setup (your machine)

### 1. Commit and push CI/CD files

```powershell
cd "e:\Pydah Academic portal"
git add .gitignore backend/.env.example backend/src/index.ts scripts .github docs/LIGHTSAIL_CICD.md
git status
git commit -m "chore: add Lightsail CI/CD deploy workflow"
git push origin main
```

Do **not** add `*.pem` or real `.env` files.

### 2. Add GitHub Actions secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret name | Value |
|---|---|
| `LIGHTSAIL_HOST` | `13.204.83.221` |
| `LIGHTSAIL_USER` | `ec2-user` |
| `LIGHTSAIL_SSH_KEY` | Full contents of `LightsailDefaultKey-ap-south-1 (1).pem` (including `BEGIN` / `END` lines) |

#### Optional: set secrets from PowerShell (needs GitHub CLI)

```powershell
cd "e:\Pydah Academic portal"
gh auth login
gh secret set LIGHTSAIL_HOST --body "13.204.83.221"
gh secret set LIGHTSAIL_USER --body "ec2-user"
gh secret set LIGHTSAIL_SSH_KEY < "LightsailDefaultKey-ap-south-1 (1).pem"
```

### 3. Confirm Lightsail networking

In Lightsail → instance → **Networking**:

- **SSH** TCP `22` — open  
- **HTTP** TCP `80` — open  

### 4. First CI/CD run

After secrets exist:

```powershell
git push origin main
```

Or GitHub → **Actions** → **Deploy Lightsail** → **Run workflow**.

Watch the job until it shows `DEPLOY_OK`, then open:

- App: http://13.204.83.221  
- API: http://13.204.83.221/api/health  

## Manual deploy from your PC (without waiting for Actions)

```powershell
$pem = "$env:USERPROFILE\.ssh\lightsail-academic-portal-ap-south-1.pem"
# or: $pem = "e:\Pydah Academic portal\LightsailDefaultKey-ap-south-1 (1).pem"
$host = "13.204.83.221"
$user = "ec2-user"

rsync -az --delete -e "ssh -i `"$pem`"" `
  --exclude .git --exclude node_modules --exclude .next --exclude dist `
  --exclude .env --exclude .env.local --exclude "*.pem" --exclude secrets `
  ./ "${user}@${host}:~/academic-portal/"

ssh -i $pem "${user}@${host}" "bash ~/academic-portal/scripts/deploy.sh"
```

On Windows without `rsync`, use **Git Bash** for the commands above, or rely on GitHub Actions.

## Server-only redeploy (SSH)

```bash
ssh -i ~/.ssh/lightsail-academic-portal-ap-south-1.pem ec2-user@13.204.83.221
bash ~/academic-portal/scripts/deploy.sh
pm2 status
```

## Files in this repo

| Path | Purpose |
|---|---|
| `.github/workflows/deploy-lightsail.yml` | CI/CD pipeline |
| `scripts/deploy.sh` | Build + PM2 restart on server |
| `scripts/lightsail-bootstrap.sh` | First-time server bootstrap (already used) |
| `scripts/fix-api-http.sh` | One-time HTTP cookie allow for IP deploy |

## Notes

- Server env files stay on the instance only (`backend/.env`, `frontend/.env.local`).  
- Never commit the PEM or production passwords.  
- If the Lightsail public IP changes, update `LIGHTSAIL_HOST` and server CORS / `NEXT_PUBLIC_API_BASE_URL`, then redeploy.  
- Prefer HTTPS + `AP_SESSION_SECURE=true` when you attach a domain.
