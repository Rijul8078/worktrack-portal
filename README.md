# WorkTrack Portal

## Local Setup

1. Clone the repo
2. Run: npm install
3. Go to https://supabase.com -> create free project
4. Go to SQL Editor -> paste contents of supabase/schema.sql -> Run
5. Go to Settings -> API -> copy Project URL and anon key
6. Create .env file: cp .env.example .env
7. Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
8. Run: npm run dev
9. Open http://localhost:5173
10. Sign up -> go to Supabase Dashboard -> Table Editor -> profiles table -> find your user -> change role to 'admin'

## Deploy to Netlify (Free)

1. Push code to GitHub
2. Go to https://netlify.com -> "Add new site" -> "Import from Git"
3. Connect GitHub -> select your repo
4. Build command: npm run build
5. Publish directory: dist
6. Click "Show advanced" -> add environment variables:
   VITE_SUPABASE_URL = your value
   VITE_SUPABASE_ANON_KEY = your value
7. Click "Deploy site"
8. Your app is live at https://random-name.netlify.app
9. Optional: Settings -> Domain management -> add custom domain

## Inviting Clients & Team

### Add Staff Member:
1. Ask them to sign up at your Netlify URL
2. In Supabase Dashboard -> Table Editor -> profiles
3. Find their row -> change role to 'staff'

### Add Admin:
1. Same as staff but set role to 'admin'

### Add Client:
1. Ask them to sign up at your Netlify URL
2. They default to 'client' role - no action needed
3. Create orders for them and set client_id to their profile ID

## Security Notes
- Clients can ONLY see their own orders, files, and non-internal comments
- Staff can view and edit all orders but cannot delete
- Only admins can delete orders and change user roles
- All file downloads use signed URLs (expire in 5 minutes)
- Internal comments are never visible to clients