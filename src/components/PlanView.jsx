import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";
import { trackStep, completeJourney, persistJourney } from "../analytics";
import {
  calculateDailyTargets,
  getRemainingNutrition,
  isNutritionProfileComplete,
  sumMealNutrition,
} from "../lib/nutrition";

const COOKING_SKILL_OPTIONS = [
  { id: "any", label: "Any skill level" },
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

const APPLIANCE_OPTIONS = [
  { id: "oven", label: "Oven" },
  { id: "stovetop", label: "Stovetop" },
  { id: "microwave", label: "Microwave" },
  { id: "air-fryer", label: "Air fryer" },
  { id: "blender", label: "Blender" },
  { id: "slow-cooker", label: "Slow cooker" },
];

const MEALS_PER_COMBINATION = 3;
const GUEST_MEAL_LOGS_KEY = "nutrisupport_guest_meal_logs";

function formatMinutes(m) {
  return m ? `${m} min` : "—";
}

function formatMacro(value, unit) {
  return `${Math.round(Number(value) || 0)} ${unit}`;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function readGuestMealLogs() {
  try {
    return JSON.parse(window.localStorage.getItem(GUEST_MEAL_LOGS_KEY) || "[]");
  } catch {
    return [];
  }
}

function getTodaysGuestMealLogs() {
  const { start, end } = getTodayRange();

  return readGuestMealLogs().filter(
    (meal) => meal.eaten_at >= start && meal.eaten_at < end
  );
}

function normalizeRecipe(row) {
  return {
    ...row,
    image: row.image_url,
    readyInMinutes: row.ready_in_minutes || row.prep_time_minutes,
    estimatedCost: row.cost_estimate == null ? null : Number(row.cost_estimate),
    healthScore: row.health_score == null ? null : Number(row.health_score),
    calories: row.calories == null ? 0 : Number(row.calories),
    proteinGrams: row.protein_grams == null ? 0 : Number(row.protein_grams),
    carbsGrams: row.carbs_grams == null ? 0 : Number(row.carbs_grams),
    fatGrams: row.fat_grams == null ? 0 : Number(row.fat_grams),
    cookingSkill: row.cooking_skill,
    appliancesNeeded: row.appliances_needed || [],
    dietaryTags: row.dietary_tags || [],
  };
}

function hasBudgetLimit(profile) {
  return (
    profile?.budget !== undefined &&
    profile?.budget !== null &&
    profile.budget !== ""
  );
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

    const tagCount = new Set(meals.flatMap((m) => m.dietaryTags)).size;
    const avgHealth = average(meals.map((m) => m.healthScore));
    const totalCost = meals.reduce((t, m) => t + (m.estimatedCost || 0), 0);

    const totalCalories = meals.reduce((t, m) => t + (m.calories || 0), 0);
    const totalProtein = meals.reduce((t, m) => t + (m.proteinGrams || 0), 0);
    const totalCarbs = meals.reduce((t, m) => t + (m.carbsGrams || 0), 0);
    const totalFat = meals.reduce((t, m) => t + (m.fatGrams || 0), 0);

    const balanceScore = Math.round((avgHealth || 0) + tagCount * 3);

    combos.push({
      id: meals.map((m) => m.id).join("-"),
      meals,
      avgHealth,
      balanceScore,
      totalCost,
      tagCount,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFat,
    });
  }

  return combos.sort((a, b) => b.balanceScore - a.balanceScore).slice(0, 6);
}

function MacroCard({ title, values, highlight = false }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-emerald-100 bg-emerald-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">Calories</p>
          <p className="text-sm font-bold text-gray-900">
            {formatMacro(values?.calories, "kcal")}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Protein</p>
          <p className="text-sm font-bold text-gray-900">
            {formatMacro(values?.protein, "g")}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Carbs</p>
          <p className="text-sm font-bold text-gray-900">
            {formatMacro(values?.carbs, "g")}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Fat</p>
          <p className="text-sm font-bold text-gray-900">
            {formatMacro(values?.fat, "g")}
          </p>
        </div>
      </div>
    </div>
  );
}

MacroCard.propTypes = {
  title: PropTypes.string.isRequired,
  highlight: PropTypes.bool,
  values: PropTypes.shape({
    calories: PropTypes.number,
    protein: PropTypes.number,
    carbs: PropTypes.number,
    fat: PropTypes.number,
  }),
};

export default function PlanView({ profile, session, isGuest, onOpenRecipe }) {
  const userId = session?.user?.id;

  const [maxTime, setMaxTime] = useState(45);
  const [cookingSkill, setCookingSkill] = useState("any");
  const [selectedAppliances, setSelectedAppliances] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [offset, setOffset] = useState(0);

  const [recipes, setRecipes] = useState([]);
  const [todaysMeals, setTodaysMeals] = useState(() =>
    isGuest ? getTodaysGuestMealLogs() : []
  );

  const [loading, setLoading] = useState(false);
  const [loadingMeals, setLoadingMeals] = useState(false);
  const [error, setError] = useState("");
  const [mealLogError, setMealLogError] = useState("");

  const profileIsComplete = isNutritionProfileComplete(profile);

  const dailyTargets = useMemo(
    () => calculateDailyTargets(profile),
    [profile]
  );

  const consumed = useMemo(
    () => sumMealNutrition(todaysMeals),
    [todaysMeals]
  );

  const remaining = useMemo(
    () => getRemainingNutrition(dailyTargets, consumed),
    [dailyTargets, consumed]
  );

  useEffect(() => {
    let live = true;

    async function loadTodaysMeals() {
      if (isGuest) {
        const guestMeals = getTodaysGuestMealLogs();
        if (live) setTodaysMeals(guestMeals);
        return;
      }

      if (!userId) return;

      const todayRange = getTodayRange();

      const { data, error: mealError } = await supabase
        .from("meal_logs")
        .select("*")
        .eq("user_id", userId)
        .gte("eaten_at", todayRange.start)
        .lt("eaten_at", todayRange.end)
        .order("eaten_at", { ascending: false });

      if (!live) return;

      if (!mealError) {
        setTodaysMeals(data || []);
      }
    }

    loadTodaysMeals();

    return () => {
      live = false;
    };
  }, [isGuest, userId]);

  useEffect(() => {
    let live = true;

    async function loadRecipes() {
      setLoading(true);
      setError("");

      try {
        let query = supabase
          .from("recipes")
          .select("*")
          .order("health_score", { ascending: false, nullsFirst: false })
          .limit(60)
          .lte("prep_time_minutes", maxTime);

        if (hasBudgetLimit(profile)) {
          query = query.lte("cost_estimate", Number(profile.budget));
        }

        const dietary = profile?.dietary_requirements || [];

        if (dietary.length > 0) {
          query = query.contains("dietary_tags", dietary);
        }

        if (cookingSkill !== "any") {
          query = query.eq("cooking_skill", cookingSkill);
        }

        if (selectedAppliances.length > 0) {
          query = query.contains("appliances_needed", selectedAppliances);
        }

        const { data, error: recipeError } = await query;
        if (recipeError) throw recipeError;

        if (live) {
          setRecipes((data || []).map(normalizeRecipe));
        }
      } catch (err) {
        if (live) {
          setError(err.message || "Could not load recipes.");
          setRecipes([]);
        }
      } finally {
        if (live) setLoading(false);
      }
    }

    loadRecipes();

    return () => {
      live = false;
    };
  }, [profile, maxTime, cookingSkill, selectedAppliances]);

  const combinations = useMemo(
    () => buildMealCombinations(recipes, offset),
    [recipes, offset]
  );

  const toggleAppliance = (id) => {
    setSelectedAppliances((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
    setOffset(0);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Meal plan</h2>
          <p className="text-sm text-gray-500">
            Balanced combinations of three recipes, now checked against your
            daily calorie and macro targets.
          </p>
        </div>

        {!profileIsComplete && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
            Complete weight, height, age, activity level, and goal in Profile
            Settings to see calorie tracking in Plan.
          </div>
        )}

        {dailyTargets && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MacroCard title="Daily target" values={dailyTargets} />
            <MacroCard title={loadingMeals ? "Loading eaten today" : "Eaten today"} values={consumed} />
            <MacroCard title="Remaining now" values={remaining} highlight />
          </div>
        )}

        {mealLogError && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {mealLogError}
          </p>
        )}

        <div className="max-w-xl space-y-2">
          <div className="flex items-center justify-between text-sm">
            <label className="font-semibold text-gray-700">Cooking time</label>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              {maxTime} min or less
            </span>
          </div>

          <input
            type="range"
            min="10"
            max="120"
            step="5"
            value={maxTime}
            onChange={(e) => {
              setMaxTime(Number(e.target.value));
              setOffset(0);
            }}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-emerald-600"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700"
        >
          <span>{showFilters ? "Hide filters" : "More filters"}</span>
          <svg
            className={`h-4 w-4 transition-transform ${
              showFilters ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {showFilters && (
          <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Cooking skill
              </label>
              <select
                value={cookingSkill}
                onChange={(e) => {
                  setCookingSkill(e.target.value);
                  setOffset(0);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {COOKING_SKILL_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <span className="block text-sm font-semibold text-gray-700">
                Appliances
              </span>
              <div className="flex flex-wrap gap-2">
                {APPLIANCE_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggleAppliance(o.id)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      selectedAppliances.includes(o.id)
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <p className="animate-pulse text-sm text-gray-400">
            Loading recipes…
          </p>
        </div>
      ) : recipes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <p className="font-medium text-gray-400">
            No recipes match your filters.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Try extending the time slider or removing filters.
          </p>
        </div>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500">
              {combinations.length} combination
              {combinations.length !== 1 ? "s" : ""} — click any recipe to see
              the full details.
            </p>

            <button
              type="button"
              onClick={() => setOffset((o) => o + MEALS_PER_COMBINATION)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Shuffle
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {combinations.map((combo) => {
              const leftAfterPlan = remaining
                ? {
                    calories: remaining.calories - combo.totalCalories,
                    protein: remaining.protein - combo.totalProtein,
                    carbs: remaining.carbs - combo.totalCarbs,
                    fat: remaining.fat - combo.totalFat,
                  }
                : null;

              return (
                <article
                  key={combo.id}
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-gray-900">Meal combo</p>
                      <p className="text-xs text-gray-500">
                        Balance score {combo.balanceScore}
                      </p>
                    </div>

                    {combo.totalCost > 0 && (
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700">
                        £{combo.totalCost.toFixed(2)} total
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {combo.meals.map((meal) => (
                      <div
                        key={meal.id}
                        className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            trackStep("opened_recipe_from_meal_combo");
                            const metrics = completeJourney(meal.id);
                            persistJourney(
                              metrics,
                              supabase,
                              session?.user?.id
                            );
                            onOpenRecipe(meal.id);
                          }}
                          className="text-left text-sm font-bold text-gray-900 hover:text-emerald-700"
                        >
                          {meal.title}
                        </button>

                        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                          <span className="rounded bg-white px-1.5 py-0.5">
                            {formatMinutes(meal.readyInMinutes)}
                          </span>
                          <span className="rounded bg-white px-1.5 py-0.5">
                            {formatMacro(meal.calories, "kcal")}
                          </span>
                          {meal.cookingSkill && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-500">
                              {meal.cookingSkill}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                    <span>Total cal: {formatMacro(combo.totalCalories, "kcal")}</span>
                    <span>Protein: {formatMacro(combo.totalProtein, "g")}</span>
                    <span>Carbs: {formatMacro(combo.totalCarbs, "g")}</span>
                    <span>Fat: {formatMacro(combo.totalFat, "g")}</span>
                    <span>Avg health: {combo.avgHealth?.toFixed(0) ?? "N/A"}</span>
                    <span>Variety: {combo.tagCount} tags</span>
                  </div>

                  {leftAfterPlan && (
                    <div
                      className={`rounded-lg p-3 text-xs font-semibold ${
                        leftAfterPlan.calories < 0
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {leftAfterPlan.calories < 0
                        ? `${Math.abs(
                            Math.round(leftAfterPlan.calories)
                          )} kcal over today’s remaining target`
                        : `${Math.round(
                            leftAfterPlan.calories
                          )} kcal left after this plan`}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

PlanView.propTypes = {
  isGuest: PropTypes.bool,
  onOpenRecipe: PropTypes.func.isRequired,
  session: PropTypes.shape({
    user: PropTypes.shape({ id: PropTypes.string.isRequired }),
  }),
  profile: PropTypes.shape({
    budget: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
    weight_kg: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    height_cm: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    age: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    activity_level: PropTypes.string,
    goal: PropTypes.string,
  }),
};