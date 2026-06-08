// The tracks...

let journey = null;
let completed = false;

export function startJourney() {
  journey = {
    startedAt: Date.now(),
    clicks: 0,
    steps: ["session_started"],
  };
}

export function trackStep(step) {
  if (!journey) return;

  journey.clicks++;
  journey.steps.push(step);
}

export function completeJourney(recipeId) {
  if (completed) return null
  if (!journey) return null;

  completed = true;
  return {
    recipeId,
    durationMs: Date.now() - journey.startedAt,
    clicks: journey.clicks,
    steps: journey.steps,
  };
}

export async function persistJourney(metrics, supabase, userId) {
  return supabase.from("events").insert({
    event_name: "journey_completed",
    visitor_id: userId ?? "guest",
    data: metrics,
  });
}