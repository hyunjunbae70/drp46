import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";
import {
  buildMealMacroFilters,
  calculateDailyTargets,
  getRemainingNutrition,
  isNutritionProfileComplete,
  sumMealNutrition,
} from "../lib/nutrition";
import { fetchSpoonacularMealSuggestions } from "../lib/spoonacular";

const GUEST_MEAL_LOGS_KEY = "nutrisupport_guest_meal_logs";

const COOKING_SKILL_OPTIONS = [
  { id: "any",          label: "Any skill level" },
  { id: "beginner",     label: "Beginner"        },
  { id: "intermediate", label: "Intermediate"    },
  { id: "advanced",     label: "Advanced"        },
];

const APPLIANCE_OPTIONS = [
  { id: "oven",         label: "Oven"         },
  { id: "stovetop",     label: "Stovetop"     },
  { id: "microwave",    label: "Microwave"    },
  { id: "air-fryer",    label: "Air fryer"    },
  { id: "blender",      label: "Blender"      },
  { id: "slow-cooker",  label: "Slow cooker"  },
];

const MACRO_ITEMS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein",  label: "Protein",  unit: "g"    },
  { key: "carbs",    label: "Carbs",    unit: "g"    },
  { key: "fat",      label: "Fat",      unit: "g"    },
];

const EMPTY_MANUAL_MEAL = { title: "", calories: "", protein: "", carbs: "", fat: "" };

function formatMacro(value, unit) {
  return `${Math.round(Number(value) || 0)} ${unit}`;
}

function formatMinutes(minutes) {
  if (!minutes) return "—";
  return `${minutes} min`;
}

function formatCost(cost) {
  if (!cost) return null;
  return `£${Number(cost).toFixed(2)}`;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function readGuestMealLogs() {
  try { return JSON.parse(window.localStorage.getItem(GUEST_MEAL_LOGS_KEY) || "[]"); }
  catch { return []; }
}

function writeGuestMealLogs(meals) {
  window.localStorage.setItem(GUEST_MEAL_LOGS_KEY, JSON.stringify(meals));
}

function getTodaysGuestMealLogs() {
  const { start, end } = getTodayRange();
  return readGuestMealLogs().filter((m) => m.eaten_at >= start && m.eaten_at < end);
}

function normalizeRecipe(row) {
  return {
    ...row,
    image: row.image_url,
    readyInMinutes: row.ready_in_minutes || row.prep_time_minutes,
    estimatedCost: row.cost_estimate == null ? null : Number(row.cost_estimate),
    calories: row.calories == null ? null : Number(row.calories),
    proteinGrams: row.protein_grams == null ? null : Number(row.protein_grams),
    carbsGrams: row.carbs_grams == null ? null : Number(row.carbs_grams),
    fatGrams: row.fat_grams == null ? null : Number(row.fat_grams),
    cookingSkill: row.cooking_skill,
    appliancesNeeded: row.appliances_needed || [],
    dietaryTags: row.dietary_tags || [],
    extendedIngredients: row.ingredients || [],
    instructionSteps: row.instructions || [],
  };
}

function hasBudgetLimit(profile) {
  return profile?.budget !== undefined && profile?.budget !== null && profile.budget !== "";
}

// ─── Macro summary strip ──────────────────────────────────────────────────────

function MacroStrip({ title, values, highlight }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-emerald-100 bg-emerald-50" : "border-gray-200 bg-white"}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {MACRO_ITEMS.map((item) => (
          <div key={item.key}>
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className="text-sm font-bold text-gray-900">
              {formatMacro(values?.[item.key], item.unit)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Recipe detail sheet ─────────────────────────────────────────────────────

function RecipeDetailView({ recipe, onBack, onLog, logging }) {
  const steps = recipe.instructionSteps?.length > 0
    ? recipe.instructionSteps.map((s) => s.step || s)
    : [];

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
      >
        ← Back to recipes
      </button>

      <article className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {recipe.dietaryTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700"
                >
                  {tag}
                </span>
              ))}
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {recipe.title}
            </h1>

            {recipe.description && (
              <p className="text-base leading-7 text-gray-600">
                {recipe.description}
              </p>
            )}
          </div>

          {recipe.image && (
            <img
              src={recipe.image}
              alt={recipe.title}
              className="aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              label: "Ready in",
              value: formatMinutes(recipe.readyInMinutes),
            },
            {
              label: "Servings",
              value: recipe.servings || "Flexible",
            },
            {
              label: "Est. cost",
              value: formatCost(recipe.estimatedCost) || "Not listed",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {item.label}
              </p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {(recipe.calories ||
          recipe.proteinGrams ||
          recipe.carbsGrams ||
          recipe.fatGrams) && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Calories
              </p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {formatMacro(recipe.calories, "kcal")}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Protein
              </p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {formatMacro(recipe.proteinGrams, "g")}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Carbs
              </p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {formatMacro(recipe.carbsGrams, "g")}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Fat
              </p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {formatMacro(recipe.fatGrams, "g")}
              </p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-emerald-900">
                Ready to add this to today’s log?
              </p>
              <p className="text-sm text-emerald-700">
                This will count the recipe’s calories and macros toward your daily totals.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onLog(recipe)}
              disabled={logging}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {logging ? "Logging…" : "Log this meal"}
            </button>
          </div>
        </div>

        {recipe.extendedIngredients?.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-gray-900">
              Ingredients
            </h2>

            <ul className="grid gap-2 sm:grid-cols-2">
              {recipe.extendedIngredients.map((ing, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700"
                >
                  {ing.original || ing}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xl font-bold text-gray-900">
            Instructions
          </h2>

          {steps.length > 0 ? (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-6 text-gray-700">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-500">
              No step-by-step instructions yet.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}

// ─── Main TodayView ───────────────────────────────────────────────────────────

export default function TodayView({ profile, session, isGuest }) {
  const userId = session?.user?.id;

  // filters
  const [maxTime, setMaxTime]                   = useState(45);
  const [cookingSkill, setCookingSkill]         = useState("any");
  const [selectedAppliances, setSelectedAppliances] = useState([]);
  const [showFilters, setShowFilters]           = useState(false);

  // recipes
  const [recipes, setRecipes]         = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError]     = useState("");

  // detail sheet
  const [sheetRecipe, setSheetRecipe] = useState(null);
  const [loggingFromSheet, setLoggingFromSheet] = useState(false);

  // meal log
  const [todaysMeals, setTodaysMeals]   = useState(() => isGuest ? getTodaysGuestMealLogs() : []);
  const [loadingMeals, setLoadingMeals] = useState(false);
  const [removingId, setRemovingId]     = useState(null);

  // manual log
  const [manualMeal, setManualMeal]         = useState(EMPTY_MANUAL_MEAL);
  const [loggingManual, setLoggingManual]   = useState(false);

  // spoonacular suggest
  const [suggesting, setSuggesting]         = useState(false);
  const [suggestions, setSuggestions]       = useState([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [savingSuggId, setSavingSuggId]     = useState(null);

  const [message, setMessage] = useState({ text: "", type: "" });

  const profileIsComplete = isNutritionProfileComplete(profile);
  const dailyTargets = useMemo(() => calculateDailyTargets(profile), [profile]);
  const consumed     = useMemo(() => sumMealNutrition(todaysMeals), [todaysMeals]);
  const remaining    = useMemo(() => getRemainingNutrition(dailyTargets, consumed), [dailyTargets, consumed]);
  const mealFilters  = useMemo(() => buildMealMacroFilters(dailyTargets, consumed, profile?.goal), [dailyTargets, consumed, profile?.goal]);

  // fetch recipes when filters change
  useEffect(() => {
    let live = true;
    async function load() {
      setRecipesLoading(true);
      setRecipesError("");
      try {
        let q = supabase
          .from("recipes")
          .select("*")
          .order("health_score", { ascending: false, nullsFirst: false })
          .limit(60)
          .lte("prep_time_minutes", maxTime);

        if (hasBudgetLimit(profile)) q = q.lte("cost_estimate", Number(profile.budget));
        const dietary = profile?.dietary_requirements || [];
        if (dietary.length > 0) q = q.contains("dietary_tags", dietary);
        if (cookingSkill !== "any") q = q.eq("cooking_skill", cookingSkill);
        if (selectedAppliances.length > 0) q = q.contains("appliances_needed", selectedAppliances);

        const { data, error } = await q;
        if (error) throw error;
        if (live) setRecipes((data || []).map(normalizeRecipe));
      } catch (err) {
        if (live) { setRecipesError(err.message || "Could not load recipes."); setRecipes([]); }
      } finally {
        if (live) setRecipesLoading(false);
      }
    }
    load();
    return () => { live = false; };
  }, [profile, maxTime, cookingSkill, selectedAppliances]);

  // fetch today's meal log
  useEffect(() => {
    if (isGuest || !userId) return;
    let live = true;
    const { start, end } = getTodayRange();
    setLoadingMeals(true);
    supabase
      .from("meal_logs")
      .select("*")
      .eq("user_id", userId)
      .gte("eaten_at", start)
      .lt("eaten_at", end)
      .order("eaten_at", { ascending: false })
      .then(({ data, error }) => {
        if (!live) return;
        if (!error) setTodaysMeals(data || []);
        setLoadingMeals(false);
      });
    return () => { live = false; };
  }, [isGuest, userId]);

  // ── helpers ──

  const insertMealLog = async (meal) => {
    const payload = {
      title: meal.title?.trim() || "Meal",
      image_url: meal.image ?? null,
      ready_in_minutes: meal.readyInMinutes ?? null,
      calories: Math.max(0, Number(meal.calories) || 0),
      protein_g: Math.max(0, Number(meal.proteinGrams ?? meal.protein) || 0),
      carbs_g: Math.max(0, Number(meal.carbsGrams ?? meal.carbs) || 0),
      fat_g: Math.max(0, Number(meal.fatGrams ?? meal.fat) || 0),
      eaten_at: new Date().toISOString(),
    };

    if (isGuest) {
      const saved = { ...payload, id: `guest-${Date.now()}` };
      const next = [saved, ...todaysMeals];
      setTodaysMeals(next);
      writeGuestMealLogs(next);
      return saved;
    }

    const { data, error } = await supabase
      .from("meal_logs")
      .insert({ ...payload, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    setTodaysMeals((prev) => [data, ...prev]);
    return data;
  };

  const handleLogFromSheet = async (recipe) => {
    setLoggingFromSheet(true);
    setMessage({ text: "", type: "" });
    try {
      await insertMealLog(recipe);
      setMessage({ text: `"${recipe.title}" logged for today.`, type: "success" });
      setSheetRecipe(null);
    } catch (err) {
      setMessage({ text: err.message || "Could not log meal.", type: "error" });
    } finally {
      setLoggingFromSheet(false);
    }
  };

  const handleLogManual = async (e) => {
    e.preventDefault();
    if (!manualMeal.title.trim()) { setMessage({ text: "Meal name is required.", type: "error" }); return; }
    setLoggingManual(true);
    setMessage({ text: "", type: "" });
    try {
      await insertMealLog({
        title: manualMeal.title,
        calories: manualMeal.calories,
        protein: manualMeal.protein,
        carbs: manualMeal.carbs,
        fat: manualMeal.fat,
      });
      setManualMeal(EMPTY_MANUAL_MEAL);
      setMessage({ text: "Meal logged.", type: "success" });
    } catch (err) {
      setMessage({ text: err.message || "Could not log meal.", type: "error" });
    } finally {
      setLoggingManual(false);
    }
  };

  const handleRemoveMeal = async (mealId) => {
    setRemovingId(mealId);
    if (isGuest) {
      const next = todaysMeals.filter((m) => m.id !== mealId);
      setTodaysMeals(next);
      writeGuestMealLogs(next);
      setRemovingId(null);
      return;
    }
    await supabase.from("meal_logs").delete().eq("id", mealId).eq("user_id", userId);
    setTodaysMeals((prev) => prev.filter((m) => m.id !== mealId));
    setRemovingId(null);
  };

  const handleSuggestMeal = async () => {
    if (!profileIsComplete) {
      setMessage({ text: "Complete your profile first (weight, height, age, activity, goal).", type: "error" });
      return;
    }
    if (!mealFilters) {
      setMessage({ text: "Remaining calories are too low for a suggestion.", type: "error" });
      return;
    }
    setSuggesting(true);
    setMessage({ text: "", type: "" });
    try {
      const results = await fetchSpoonacularMealSuggestions({
        profile,
        filters: mealFilters,
        maxTime,
        recipeFilters: { cookingSkill, selectedAppliances },
      });
      setSuggestions(results);
      setSuggestionIndex(0);
      if (results.length === 0) setMessage({ text: "No Spoonacular meals matched today's limits.", type: "error" });
    } catch (err) {
      setMessage({ text: err.message || "Could not fetch suggestions.", type: "error" });
    } finally {
      setSuggesting(false);
    }
  };

  const handleAddSuggestion = async (meal) => {
    setSavingSuggId(meal.spoonacularId);
    try {
      await insertMealLog(meal);
      setSuggestions((prev) => prev.filter((s) => s.spoonacularId !== meal.spoonacularId));
      setSuggestionIndex((i) => Math.max(0, Math.min(i, suggestions.length - 2)));
      setMessage({ text: "Meal added to today's log.", type: "success" });
    } catch (err) {
      setMessage({ text: err.message || "Could not add meal.", type: "error" });
    } finally {
      setSavingSuggId(null);
    }
  };

  const toggleAppliance = (id) =>
    setSelectedAppliances((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );

  const currentSuggestion = suggestions[suggestionIndex] || null;

  if (sheetRecipe) {
    return (
      <div className="space-y-6">
        <RecipeDetailView
          recipe={sheetRecipe}
          onBack={() => setSheetRecipe(null)}
          onLog={handleLogFromSheet}
          logging={loggingFromSheet}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Macro summary ── */}
      {dailyTargets && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MacroStrip title="Daily target" values={dailyTargets} />
          <MacroStrip title="Eaten today"  values={consumed} />
          <MacroStrip title="Remaining"    values={remaining} highlight />
        </div>
      )}

      {!profileIsComplete && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Complete your weight, height, age, activity level, and goal in Profile to see daily targets.
        </div>
      )}

      {message.text && (
        <p className={`rounded-xl border px-4 py-3 text-sm font-medium ${
          message.type === "error"
            ? "border-red-100 bg-red-50 text-red-700"
            : "border-green-100 bg-green-50 text-green-700"
        }`}>
          {message.text}
        </p>
      )}

      {/* ── Filters + recipe browser ── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Find a recipe</h2>
            <p className="text-sm text-gray-500">Filter by time, skill, and appliances — then pick something to log.</p>
          </div>
          <button
            type="button"
            onClick={handleSuggestMeal}
            disabled={suggesting || !profileIsComplete}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {suggesting ? "Finding…" : "Suggest a meal"}
          </button>
        </div>

        {/* Time slider */}
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <label
              htmlFor="today-time"
              className="block text-center text-sm font-semibold text-gray-700"
            >
              Available Cooking time
            </label>

            <div className="flex justify-center">
              <span className="rounded-full bg-emerald-100 px-4 py-2 text-base font-bold text-emerald-800">
                {maxTime} min or less
              </span>
            </div>

            <input
              id="today-time"
              type="range"
              min="10"
              max="120"
              step="5"
              value={maxTime}
              onChange={(e) => setMaxTime(Number(e.target.value))}
              className="h-3 w-full cursor-pointer appearance-none rounded-full bg-gray-300 accent-emerald-600"
            />

            <div className="flex justify-between text-xs font-medium text-gray-400">
              <span>10 min</span>
              <span>2 hours</span>
            </div>
          </div>
        </div>

        {/* More filters toggle */}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700"
        >
          <span>{showFilters ? "Hide filters" : "More filters"}</span>
          <svg className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        {showFilters && (
          <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="today-skill" className="block text-sm font-semibold text-gray-700">Cooking skill</label>
              <select
                id="today-skill"
                value={cookingSkill}
                onChange={(e) => setCookingSkill(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {COOKING_SKILL_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-gray-700">Appliances</span>
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

        {/* Spoonacular suggestion card */}
        {(suggesting || currentSuggestion) && (
          <div className="border-t border-gray-100 pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Suggested meal {suggestions.length > 0 ? `(${suggestionIndex + 1} of ${suggestions.length})` : ""}
            </p>
            {suggesting ? (
              <div className="flex justify-center py-8">
                <p className="animate-pulse text-sm text-gray-400">Asking Spoonacular…</p>
              </div>
            ) : currentSuggestion && (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                {currentSuggestion.imageUrl && (
                  <img src={currentSuggestion.imageUrl} alt="" className="h-40 w-full object-cover" />
                )}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold text-gray-900">{currentSuggestion.title}</p>
                    <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">
                      {currentSuggestion.readyInMinutes} min
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <span className="rounded bg-gray-50 px-1 py-1 font-semibold text-gray-700">{formatMacro(currentSuggestion.calories, "kcal")}</span>
                    <span className="rounded bg-blue-50 px-1 py-1 font-semibold text-blue-700">{formatMacro(currentSuggestion.protein, "g")} P</span>
                    <span className="rounded bg-amber-50 px-1 py-1 font-semibold text-amber-700">{formatMacro(currentSuggestion.carbs, "g")} C</span>
                    <span className="rounded bg-rose-50 px-1 py-1 font-semibold text-rose-700">{formatMacro(currentSuggestion.fat, "g")} F</span>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSuggestionIndex((i) => Math.max(0, i - 1))} disabled={suggestionIndex === 0}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      Prev
                    </button>
                    <button type="button" onClick={() => setSuggestionIndex((i) => Math.min(suggestions.length - 1, i + 1))} disabled={suggestionIndex >= suggestions.length - 1}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      Next
                    </button>
                    <button type="button" onClick={() => handleAddSuggestion(currentSuggestion)} disabled={savingSuggId === currentSuggestion.spoonacularId}
                      className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {savingSuggId === currentSuggestion.spoonacularId ? "Adding…" : "Log this"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recipe card grid */}
        <div className="border-t border-gray-100 pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {recipesLoading ? "Loading…" : `${recipes.length} recipe${recipes.length !== 1 ? "s" : ""} match your filters`}
          </p>

          {recipesError ? (
            <p className="text-sm text-red-600">{recipesError}</p>
          ) : recipesLoading ? (
            <div className="flex justify-center py-10">
              <p className="animate-pulse text-sm text-gray-400">Loading recipes…</p>
            </div>
          ) : recipes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
              <p className="text-sm font-medium text-gray-400">No recipes match your filters.</p>
              <p className="mt-1 text-xs text-gray-400">Try adjusting the time slider or filters above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {recipes.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  onClick={() => setSheetRecipe(recipe)}
                  className="group overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md"
                >
                  {recipe.image ? (
                    <img src={recipe.image} alt={recipe.title} className="h-28 w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-28 w-full bg-gray-100 flex items-center justify-center">
                      <span className="text-xs text-gray-400">No image</span>
                    </div>
                  )}
                  <div className="p-3 space-y-1.5">
                    <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-2 group-hover:text-emerald-700">
                      {recipe.title}
                    </p>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{formatMinutes(recipe.readyInMinutes)}</span>
                      {recipe.estimatedCost && <span>{formatCost(recipe.estimatedCost)}</span>}
                    </div>
                    {recipe.cookingSkill && (
                      <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600">
                        {recipe.cookingSkill}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Log a meal manually ── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Log a meal manually</h2>
        <form onSubmit={handleLogManual} className="space-y-3">
          <input
            type="text"
            value={manualMeal.title}
            onChange={(e) => setManualMeal((p) => ({ ...p, title: e.target.value }))}
            placeholder="Meal name"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MACRO_ITEMS.map((item) => (
              <input
                key={item.key}
                type="number" min="0" step="0.1"
                value={manualMeal[item.key] ?? ""}
                onChange={(e) => setManualMeal((p) => ({ ...p, [item.key]: e.target.value }))}
                placeholder={`${item.label} (${item.unit})`}
                className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={loggingManual}
            className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition"
          >
            {loggingManual ? "Logging…" : "Log meal"}
          </button>
        </form>
      </section>

      {/* ── Today's meal log ── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Today's log</h2>
          <span className="text-xs font-semibold text-gray-400">{todaysMeals.length} logged</span>
        </div>

        {loadingMeals ? (
          <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
        ) : todaysMeals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
            <p className="text-sm font-medium text-gray-400">Nothing logged yet today.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {todaysMeals.map((meal) => (
              <li key={meal.id} className="flex items-center gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="truncate font-semibold text-gray-900 text-sm">{meal.title}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(meal.eaten_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="hidden sm:flex gap-2 text-xs shrink-0">
                  <span className="rounded bg-gray-100 px-2 py-1 font-semibold text-gray-700">{formatMacro(meal.calories, "kcal")}</span>
                  <span className="rounded bg-blue-50 px-2 py-1 font-semibold text-blue-700">{formatMacro(meal.protein_g, "g")} P</span>
                  <span className="rounded bg-amber-50 px-2 py-1 font-semibold text-amber-700">{formatMacro(meal.carbs_g, "g")} C</span>
                  <span className="rounded bg-rose-50 px-2 py-1 font-semibold text-rose-700">{formatMacro(meal.fat_g, "g")} F</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveMeal(meal.id)}
                  disabled={removingId === meal.id}
                  className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  {removingId === meal.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      
    </div>
  );
}

TodayView.propTypes = {
  isGuest: PropTypes.bool,
  session: PropTypes.shape({ user: PropTypes.shape({ id: PropTypes.string.isRequired }) }),
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
