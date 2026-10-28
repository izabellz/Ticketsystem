// Deploy with: supabase functions deploy notify-ticket
// Set secrets with: supabase secrets set RESEND_API_KEY=re_... SUPPORT_EMAIL=you@example.com APP_URL=https://user.github.io/repo/
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const { ticket_id, event } = await req.json();
    if (typeof ticket_id !== "string" || !["created", "reply"].includes(event)) return json({ error: "Invalid request" }, 400);
    const { data: actor } = await admin.from("profiles").select("id,email,role,display_name").eq("id", user.id).single();
    const { data: ticket, error: ticketError } = await admin.from("tickets").select("id,ticket_number,subject,description,owner_id,status,priority,profiles!tickets_owner_id_fkey(email,display_name)").eq("id", ticket_id).single();
    if (ticketError || !ticket || !actor) return json({ error: "Ticket not found" }, 404);
    if (actor.role !== "admin" && ticket.owner_id !== user.id) return json({ error: "Forbidden" }, 403);

    const { data: owner } = await admin.from("profiles").select("email,display_name").eq("id", ticket.owner_id).single();
    const supportEmail = Deno.env.get("SUPPORT_EMAIL");
    const appUrl = Deno.env.get("APP_URL") || "";
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey || !supportEmail) return json({ error: "Email service is not configured" }, 500);

    const isAdmin = actor.role === "admin";
    const recipient = event === "created" ? supportEmail : (isAdmin ? owner?.email : supportEmail);
    if (!recipient) return json({ error: "No recipient configured" }, 500);
    const safeSubject = String(ticket.subject).replace(/[\r\n]/g, " ").slice(0, 160);
    const ticketNo = ticket.ticket_number ?? ticket.id.slice(0, 8);
    const html = `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.6"><h2>Support-Ticket #${ticketNo}</h2><p><b>${escapeHtml(safeSubject)}</b></p><p>Status: ${escapeHtml(ticket.status)} · Priorität: ${escapeHtml(ticket.priority)}</p><p>${event === "created" ? "Ein neues Ticket wurde erstellt." : "Es gibt eine neue Antwort."}</p><p><a href="${appUrl}">Helpdesk öffnen</a></p><p style="color:#667085;font-size:12px">Automatische Benachrichtigung. Bitte antworte im Ticketsystem.</p></div>`;
    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "Helpdesk <onboarding@resend.dev>",
        to: [recipient],
        subject: `Ticket #${ticketNo}: ${safeSubject}`,
        html,
      }),
    });
    if (!mail.ok) {
      const detail = await mail.text();
      console.error("Resend rejected email", detail);
      return json({ error: "Email provider rejected the message" }, 502);
    }
    return json({ sent: true });
  } catch (err) {
    console.error("notify-ticket failed", err);
    return json({ error: "Unexpected error" }, 500);
  }
});

function escapeHtml(input: string) {
  return input.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]!));
}