-- Day 3 migration: LLM tracking, Google Calendar integration

-- Add Google Calendar event IDs to appointments
ALTER TABLE "appointments" ADD COLUMN "google_calendar_event_id" TEXT;
ALTER TABLE "appointments" ADD COLUMN "patient_calendar_event_id" TEXT;

-- Add LLM failure tracking to symptom summaries
ALTER TABLE "symptom_summaries" ADD COLUMN "llm_failed" BOOLEAN NOT NULL DEFAULT false;

-- Add LLM failure tracking to post-visit summaries
ALTER TABLE "post_visit_summaries" ADD COLUMN "llm_failed" BOOLEAN NOT NULL DEFAULT false;

-- Create Google Calendar tokens table
CREATE TABLE "google_calendar_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_tokens_pkey" PRIMARY KEY ("id")
);

-- Create unique index on user_id
CREATE UNIQUE INDEX "google_calendar_tokens_user_id_key" ON "google_calendar_tokens"("user_id");

-- Add foreign key
ALTER TABLE "google_calendar_tokens" ADD CONSTRAINT "google_calendar_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
