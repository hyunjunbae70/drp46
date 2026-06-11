import { useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";
import { trackStep, completeJourney, persistJourney } from "../analytics";


const COOKING_SKILL_OPTIONS = [
  { id: "any",          label: "Any skill level" },
  { id: "beginner",     label: "Beginner"        },
  { id: "intermediate", label: "Intermediate"    },
  { id: "advanced",     label: "Advanced"        },
];

const APPLIANCE_OPTIONS = [
  { id: "oven",        label: "Oven"        },
  { id: "stovetop",    label: "Stovetop"    },
  { id: "microwave",   label: "Microwave"   },
  { id: "air-fryer",   label: "Air fryer"   },
  { id: "blender",     label: "Blender"     },
  { id: "slow-cooker", label: "Slow cooker" },
];

const MEALS_PER_COMBINATION = 3;

function formatMinutes(m) { return m ? `${m} min` : "—"; }

function normalizeRecipe(row) {
  return {
    ...row,
    image: row.image_url,
    readyInMinutes: row.ready_in_minutes || row.prep_time_minutes,
    estimatedCost: row.cost_estimate == null ? null : Number(row.cost_estimate),
    healthScore: row.health_score == null ? null : Number(row.health_score),
    calories: row.calories == null ? null : Number(row.calories),
    proteinGrams: row.protein_grams == null ? null : Number(row.protein_grams),
    cookingSkill: row.cooking_skill,
    appliancesNeeded: row.appliances_needed || [],
    dietaryTags: row.dietary_tags || [],
  };
}

function hasBudgetLimit(profile) {
  return profile?.budget !== undefined && profile?.budget !== null && profile.budget !== "";
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function buildMealCombinations(recipes, offset) {
  if (recipes.length === 0) return [];
  const rotated = recipes.map((_, i) => recipes[(i + offset) % recipes.length]);
  const combos = [];
  for (let i = 0; i < rotated.length; i += MEALS_PER_COMBINATION) {
    const meals = rotated.slice(i, i + MEALS_PER_COMBINATION);
    if (meals.length < MEALS_PER_COMBINATION) break;
    const tagCount      = new Set(meals.flatMap((m) => m.dietaryTags)).size;
    const avgHealth     = average(meals.map((m) => m.healthScore));
    const avgCalories   = average(meals.map((m) => m.calories));
    const avgProtein    = average(meals.map((m) => m.proteinGrams));
    const totalCost     = meals.reduce((t, m) => t + (m.estimatedCost || 0), 0);
    const balanceScore  = Math.round((avgHealth || 0) + tagCount * 3);
    combos.push({ id: meals.map((m) => m.id).join("-"), meals, avgHealth, avgCalories, avgProtein, balanceScore, totalCost, tagCount });
  }
  return combos.sort((a, b) => b.balanceScore - a.balanceScore).slice(0, 6);
}

export default function PlanView({ profile, session, isGuest, onOpenRecipe }) {
  const userId = session?.user?.id;

  const [maxTime, setMaxTime]                       = useState(45);
  const [cookingSkill, setCookingSkill]             = useState("any");
  const [selectedAppliances, setSelectedAppliances] = useState([]);
  const [showFilters, setShowFilters]               = useState(false);
  const [offset, setOffset]                         = useState(0);

  const [recipes, setRecipes]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    let live = true;
    async function load() {
      setLoading(true); setError("");
      try {
        let q = supabase.from("recipes").select("*")
          .order("health_score", { ascending: false, nullsFirst: false })
          .limit(60)
          .lte("prep_time_minutes", maxTime);
        if (hasBudgetLimit(profile)) q = q.lte("cost_estimate", Number(profile.budget));
        const dietary = profile?.dietary_requirements || [];
        if (dietary.length > 0) q = q.contains("dietary_tags", dietary);
        if (cookingSkill !== "any") q = q.eq("cooking_skill", cookingSkill);
        if (selectedAppliances.length > 0) q = q.contains("appliances_needed", selectedAppliances);
        const { data, error: e } = await q;
        if (e) throw e;
        if (live) setRecipes((data || []).map(normalizeRecipe));
      } catch (err) {
        if (live) { setError(err.message || "Could not load recipes."); setRecipes([]); }
      } finally {
        if (live) setLoading(false);
      }
    }
    load();
    return () => { live = false; };
  }, [profile, maxTime, cookingSkill, selectedAppliances]);

  const combinations = useMemo(() => buildMealCombinations(recipes, offset), [recipes, offset]);

  const toggleAppliance = (id) =>
    setSelectedAppliances((p) => p.includes(id) ? p.filter((a) => a !== id) : [...p, id]);

  return (
    <div className="space-y-6">

      {/* Filters */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Meal plan</h2>
          <p className="text-sm text-gray-500">Balanced combinations of three recipes, scored by health, variety, and cost.</p>
        </div>

        <div className="max-w-xl space-y-2">
          <div className="flex items-center justify-between text-sm">
            <label className="font-semibold text-gray-700">Cooking time</label>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">{maxTime} min or less</span>
          </div>
          <input type="range" min="10" max="120" step="5" value={maxTime}
            onChange={(e) => { setMaxTime(Number(e.target.value)); setOffset(0); }}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-emerald-600" />
          <div className="flex justify-between text-xs font-medium text-gray-400"><span>10 min</span><span>2 hours</span></div>
        </div>

        <button type="button" onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700">
          <span>{showFilters ? "Hide filters" : "More filters"}</span>
          <svg className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showFilters && (
          <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">Cooking skill</label>
              <select value={cookingSkill} onChange={(e) => { setCookingSkill(e.target.value); setOffset(0); }}
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
                {COOKING_SKILL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <span className="block text-sm font-semibold text-gray-700">Appliances</span>
              <div className="flex flex-wrap gap-2">
                {APPLIANCE_OPTIONS.map((o) => (
                  <button key={o.id} type="button" onClick={() => { toggleAppliance(o.id); setOffset(0); }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${selectedAppliances.includes(o.id) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Combos */}
      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <p className="animate-pulse text-sm text-gray-400">Loading recipes…</p>
        </div>
      ) : recipes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <p className="font-medium text-gray-400">No recipes match your filters.</p>
          <p className="mt-1 text-xs text-gray-400">Try extending the time slider or removing filters.</p>
        </div>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500">
              {combinations.length} combination{combinations.length !== 1 ? "s" : ""} — click any recipe to see the full details in Discover.
            </p>
            <button type="button" onClick={() => setOffset((o) => o + MEALS_PER_COMBINATION)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Shuffle
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {combinations.map((combo) => (
              <article key={combo.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-gray-900">Meal combo</p>
                    <p className="text-xs text-gray-500">Balance score {combo.balanceScore}</p>
                  </div>
                  {combo.totalCost > 0 && (
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700">
                      £{combo.totalCost.toFixed(2)} total
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {combo.meals.map((meal) => (
                    <div key={meal.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <button type="button"
                        onClick={() => {
                          trackStep("opened_recipe_from_meal_combo");
                          const metrics = completeJourney(meal.id);
                          persistJourney(metrics, supabase, session?.user?.id);
                          onOpenRecipe(meal.id);
                        }}
                        className="text-left text-sm font-bold text-gray-900 hover:text-emerald-700">
                        {meal.title}
                      </button>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                        <span className="rounded bg-white px-1.5 py-0.5">{formatMinutes(meal.readyInMinutes)}</span>
                        {meal.cookingSkill && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-500">{meal.cookingSkill}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                  <span>Avg health: {combo.avgHealth?.toFixed(0) ?? "N/A"}</span>
                  <span>Variety: {combo.tagCount} tags</span>
                  <span>Avg cal: {combo.avgCalories?.toFixed(0) ?? "N/A"}</span>
                  <span>Avg protein: {combo.avgProtein?.toFixed(0) ?? "N/A"}g</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

PlanView.propTypes = {
  isGuest: PropTypes.bool,
  onOpenRecipe: PropTypes.func.isRequired,
  session: PropTypes.shape({ user: PropTypes.shape({ id: PropTypes.string.isRequired }) }),
  profile: PropTypes.shape({
    budget: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
  }),
};
