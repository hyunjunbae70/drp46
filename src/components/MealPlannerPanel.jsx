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

const EMPTY_MANUAL_MEAL = {
  title: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
};

const MACRO_ITEMS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
];

function formatMacro(value, unit) {
  return `${Math.round(Number(value) || 0)} ${unit}`;
}

function formatTime(value) {
  if (!value) return "Time not listed";
  return `${value} min`;
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

function writeGuestMealLogs(meals) {
  window.localStorage.setItem(GUEST_MEAL_LOGS_KEY, JSON.stringify(meals));
}

function getTodaysGuestMealLogs() {
  const todayRange = getTodayRange();
  return readGuestMealLogs().filter((meal) => {
    return meal.eaten_at >= todayRange.start && meal.eaten_at < todayRange.end;
  });
}

function MacroSummary({ title, values, tone = "default" }) {
  const toneClasses =
    tone === "remaining"
      ? "border-emerald-100 bg-emerald-50 text-emerald-900"
      : "border-gray-200 bg-white text-gray-900";

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {MACRO_ITEMS.map((item) => (
          <div key={item.key}>
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className="text-sm font-bold">
              {formatMacro(values?.[item.key], item.unit)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

MacroSummary.propTypes = {
  title: PropTypes.string.isRequired,
  values: PropTypes.shape({
    calories: PropTypes.number,
    protein: PropTypes.number,
    carbs: PropTypes.number,
    fat: PropTypes.number,
  }),
  tone: PropTypes.string,
};

function NutritionPills({ meal }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-center text-xs">
      <span className="rounded-lg bg-gray-50 px-2 py-1 font-semibold text-gray-700">
        {formatMacro(meal.calories, "kcal")}
      </span>
      <span className="rounded-lg bg-blue-50 px-2 py-1 font-semibold text-blue-700">
        {formatMacro(meal.protein ?? meal.protein_g, "g")} P
      </span>
      <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700">
        {formatMacro(meal.carbs ?? meal.carbs_g, "g")} C
      </span>
      <span className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-700">
        {formatMacro(meal.fat ?? meal.fat_g, "g")} F
      </span>
    </div>
  );
}

function getSuggestionPositionLabel(currentIndex, totalCount) {
  if (totalCount === 0) return "";
  return `Meal ${currentIndex + 1} of ${totalCount}`;
}

function formatFilterLabel(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getAppliedFilterLabels(recipeFilters) {
  const labels = [];

  if (recipeFilters?.cookingSkill && recipeFilters.cookingSkill !== "any") {
    labels.push(`Skill: ${formatFilterLabel(recipeFilters.cookingSkill)}`);
  }

  (recipeFilters?.selectedAppliances || []).forEach((appliance) => {
    labels.push(formatFilterLabel(appliance));
  });

  return labels;
}

NutritionPills.propTypes = {
  meal: PropTypes.shape({
    calories: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    protein: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    protein_g: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    carbs: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    carbs_g: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    fat: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    fat_g: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }).isRequired,
};

export default function MealPlannerPanel({
  profile,
  session,
  isGuest,
  maxTime,
  recipeFilters,
  showFilters,
  cookingSkillOptions,
  applianceOptions,
  onMaxTimeChange,
  onToggleFilters,
  onCookingSkillChange,
  onToggleAppliance,
}) {
  const userId = session?.user?.id;
  const [suggestions, setSuggestions] = useState([]);
  const [todaysMeals, setTodaysMeals] = useState(() =>
    isGuest ? getTodaysGuestMealLogs() : []
  );
  const [manualMeal, setManualMeal] = useState(EMPTY_MANUAL_MEAL);
  const [loadingMeals, setLoadingMeals] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [savingMealId, setSavingMealId] = useState(null);
  const [loggingManualMeal, setLoggingManualMeal] = useState(false);
  const [removingMealId, setRemovingMealId] = useState(null);
  const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0);
  const [message, setMessage] = useState({ text: "", type: "" });

  const profileIsComplete = isNutritionProfileComplete(profile);
  const dailyTargets = useMemo(() => calculateDailyTargets(profile), [profile]);
  const consumed = useMemo(() => sumMealNutrition(todaysMeals), [todaysMeals]);
  const remaining = useMemo(
    () => getRemainingNutrition(dailyTargets, consumed),
    [dailyTargets, consumed]
  );
  const mealFilters = useMemo(
    () => buildMealMacroFilters(dailyTargets, consumed, profile?.goal),
    [dailyTargets, consumed, profile?.goal]
  );
  const appliedFilterLabels = useMemo(
    () => getAppliedFilterLabels(recipeFilters),
    [recipeFilters]
  );
  const currentSuggestion = suggestions[currentSuggestionIndex] || null;

  useEffect(() => {
    if (isGuest) {
      return undefined;
    }

    if (!userId) return;

    let isCurrent = true;
    const todayRange = getTodayRange();

    async function fetchTodaysMeals() {
      setLoadingMeals(true);

      const { data, error } = await supabase
        .from("meal_logs")
        .select("*")
        .eq("user_id", userId)
        .gte("eaten_at", todayRange.start)
        .lt("eaten_at", todayRange.end)
        .order("eaten_at", { ascending: false });

      if (!isCurrent) return;

      if (error) {
        setMessage({ text: error.message, type: "error" });
      } else {
        setTodaysMeals(data || []);
      }

      setLoadingMeals(false);
    }

    fetchTodaysMeals();

    return () => {
      isCurrent = false;
    };
  }, [isGuest, userId]);

  const saveGuestMeal = (meal) => {
    const savedMeal = {
      ...meal,
      id: `guest-${Date.now()}`,
      eaten_at: new Date().toISOString(),
    };
    const nextMeals = [savedMeal, ...todaysMeals];
    setTodaysMeals(nextMeals);
    writeGuestMealLogs(nextMeals);
    return savedMeal;
  };

  const clearSuggestionsForFilterChange = () => {
    setSuggestions([]);
    setCurrentSuggestionIndex(0);
    setMessage({ text: "", type: "" });
  };

  const handleMaxTimeChange = (value) => {
    clearSuggestionsForFilterChange();
    onMaxTimeChange(value);
  };

  const handleCookingSkillChange = (value) => {
    clearSuggestionsForFilterChange();
    onCookingSkillChange(value);
  };

  const handleToggleAppliance = (applianceId) => {
    clearSuggestionsForFilterChange();
    onToggleAppliance(applianceId);
  };

  const insertMealLog = async (meal) => {
    const payload = {
      spoonacular_id: meal.spoonacularId ?? null,
      title: meal.title.trim(),
      image_url: meal.imageUrl ?? null,
      source_url: meal.sourceUrl ?? null,
      ready_in_minutes: meal.readyInMinutes ?? null,
      calories: Math.max(0, Number(meal.calories) || 0),
      protein_g: Math.max(0, Number(meal.protein) || 0),
      carbs_g: Math.max(0, Number(meal.carbs) || 0),
      fat_g: Math.max(0, Number(meal.fat) || 0),
      eaten_at: new Date().toISOString(),
    };

    if (isGuest) {
      return saveGuestMeal(payload);
    }

    if (!userId) return null;

    const { data, error } = await supabase
      .from("meal_logs")
      .insert({ ...payload, user_id: userId })
      .select()
      .single();

    if (error) throw error;
    return data;
  };

  const handleSuggestMeal = async () => {
    if (!profileIsComplete) {
      setMessage({
        text: "Complete weight, height, age, activity level, and goal in Profile Settings first.",
        type: "error",
      });
      return;
    }

    if (!mealFilters) {
      setMessage({
        text: "Today's remaining calories, carbs, or fats are too low for a balanced suggestion.",
        type: "error",
      });
      return;
    }

    setSuggesting(true);
    setMessage({ text: "", type: "" });

    try {
      const results = await fetchSpoonacularMealSuggestions({
        profile,
        filters: mealFilters,
        maxTime,
        recipeFilters,
      });

      setSuggestions(results);
      setCurrentSuggestionIndex(0);
      setMessage({
        text:
          results.length > 0
            ? "Meal suggestions are ready."
            : "No Spoonacular meals matched today's remaining limits.",
        type: results.length > 0 ? "success" : "error",
      });
    } catch (error) {
      setMessage({
        text:
          error instanceof Error
            ? error.message
            : "Could not fetch meal suggestions.",
        type: "error",
      });
    } finally {
      setSuggesting(false);
    }
  };

  const handleAddSuggestion = async (meal) => {
    setSavingMealId(meal.spoonacularId);
    setMessage({ text: "", type: "" });

    try {
      const savedMeal = await insertMealLog(meal);
      if (!isGuest) {
        setTodaysMeals((currentMeals) => [savedMeal, ...currentMeals]);
      }
      setSuggestions((currentSuggestions) =>
        currentSuggestions.filter(
          (suggestion) => suggestion.spoonacularId !== meal.spoonacularId
        )
      );
      setCurrentSuggestionIndex((currentIndex) =>
        Math.max(0, Math.min(currentIndex, suggestions.length - 2))
      );
      setMessage({ text: "Meal added to today's log.", type: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Could not add this meal.",
        type: "error",
      });
    } finally {
      setSavingMealId(null);
    }
  };

  const handleManualMealChange = (field, value) => {
    setManualMeal((currentMeal) => ({ ...currentMeal, [field]: value }));
  };

  const handleLogManualMeal = async (event) => {
    event.preventDefault();

    if (!manualMeal.title.trim()) {
      setMessage({ text: "Meal name is required.", type: "error" });
      return;
    }

    setLoggingManualMeal(true);
    setMessage({ text: "", type: "" });

    try {
      const savedMeal = await insertMealLog({
        title: manualMeal.title,
        calories: manualMeal.calories,
        protein: manualMeal.protein,
        carbs: manualMeal.carbs,
        fat: manualMeal.fat,
      });
      if (!isGuest) {
        setTodaysMeals((currentMeals) => [savedMeal, ...currentMeals]);
      }
      setManualMeal(EMPTY_MANUAL_MEAL);
      setMessage({ text: "Meal logged for today.", type: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Could not log this meal.",
        type: "error",
      });
    } finally {
      setLoggingManualMeal(false);
    }
  };

  const handleRemoveMeal = async (mealId) => {
    setRemovingMealId(mealId);
    setMessage({ text: "", type: "" });

    if (isGuest) {
      const nextMeals = todaysMeals.filter((meal) => meal.id !== mealId);
      setTodaysMeals(nextMeals);
      writeGuestMealLogs(nextMeals);
      setMessage({ text: "Meal removed from today's log.", type: "success" });
      setRemovingMealId(null);
      return;
    }

    const { error } = await supabase
      .from("meal_logs")
      .delete()
      .eq("id", mealId)
      .eq("user_id", userId);

    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setTodaysMeals((currentMeals) =>
        currentMeals.filter((meal) => meal.id !== mealId)
      );
      setMessage({ text: "Meal removed from today's log.", type: "success" });
    }

    setRemovingMealId(null);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Today's Meal Planner</h2>
          <p className="text-sm text-gray-500">
            Suggest a balanced Spoonacular meal based on your goal and today's log.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSuggestMeal}
          disabled={suggesting || !profileIsComplete}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {suggesting ? "Finding meal..." : "Suggest Balanced Meal"}
        </button>
      </div>

      {!profileIsComplete && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
          Complete your weight, height, age, activity level, and goal in Profile Settings.
        </div>
      )}

      {dailyTargets && (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <MacroSummary title="Daily target" values={dailyTargets} />
          <MacroSummary title="Eaten today" values={consumed} />
          <MacroSummary title="Remaining" values={remaining} tone="remaining" />
        </div>
      )}

      {message.text && (
        <p
          className={`mt-5 rounded-lg border p-3 text-sm font-medium ${
            message.type === "error"
              ? "border-red-100 bg-red-50 text-red-700"
              : "border-green-100 bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="max-w-xl space-y-2">
              <div className="flex items-center justify-between text-sm">
                <label
                  htmlFor="planner-time-range"
                  className="font-semibold text-gray-700"
                >
                  Available Cooking Time
                </label>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  {maxTime} minutes or less
                </span>
              </div>
              <input
                id="planner-time-range"
                type="range"
                min="10"
                max="120"
                step="5"
                value={maxTime}
                onChange={(event) =>
                  handleMaxTimeChange(Number(event.target.value))
                }
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-emerald-600 focus:outline-none"
              />
              <div className="flex justify-between px-0.5 text-xs font-medium text-gray-400">
                <span>10 min</span>
                <span>2 hours</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onToggleFilters}
                className="flex w-fit items-center gap-2 text-sm font-semibold text-gray-500 transition hover:text-gray-700 focus:outline-none"
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

              {recipeFilters?.cookingSkill !== "any" && (
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  {formatFilterLabel(recipeFilters.cookingSkill)}
                </span>
              )}
              {(recipeFilters?.selectedAppliances || []).map((appliance) => (
                <span
                  key={appliance}
                  className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700"
                >
                  {formatFilterLabel(appliance)}
                </span>
              ))}
            </div>

            {showFilters && (
              <div className="mt-4 grid gap-4 border-t border-gray-200 pt-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="planner-skill-filter"
                    className="block text-sm font-semibold text-gray-700"
                  >
                    Cooking skill
                  </label>
                  <select
                    id="planner-skill-filter"
                    value={recipeFilters?.cookingSkill || "any"}
                    onChange={(event) =>
                      handleCookingSkillChange(event.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-gray-700 focus:border-emerald-500 focus:outline-none"
                  >
                    {cookingSkillOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <span className="block text-sm font-semibold text-gray-700">
                    Appliances you have
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {applianceOptions.map((option) => {
                      const isSelected = (
                        recipeFilters?.selectedAppliances || []
                      ).includes(option.id);

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleToggleAppliance(option.id)}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                Suggested Meal
              </h3>
              {currentSuggestion && (
                <p className="text-xs font-medium text-gray-400">
                  {getSuggestionPositionLabel(
                    currentSuggestionIndex,
                    suggestions.length
                  )}
                </p>
              )}
            </div>
            {mealFilters && (
              <span className="text-xs font-medium text-gray-400">
                Max {mealFilters.maxCalories} kcal, {mealFilters.maxCarbs}g carbs,{" "}
                {mealFilters.maxFat}g fat, {maxTime} min
              </span>
            )}
          </div>

          {(appliedFilterLabels.length > 0 ||
            Number(profile?.budget) > 0 ||
            profile?.dietary_requirements?.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-gray-400">
                Suggestion filters:
              </span>
              {Number(profile?.budget) > 0 && (
                <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 font-medium text-gray-700">
                  Budget: £{profile.budget}
                </span>
              )}
              {profile?.dietary_requirements?.map((requirement) => (
                <span
                  key={requirement}
                  className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 font-medium text-emerald-700"
                >
                  {requirement}
                </span>
              ))}
              {appliedFilterLabels.map((label) => (
                <span
                  key={label}
                  className="rounded border border-blue-100 bg-blue-50 px-2 py-1 font-medium text-blue-700"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {suggesting ? (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12">
              <p className="animate-pulse text-sm text-gray-400">
                Asking Spoonacular for balanced meals...
              </p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center">
              <p className="font-medium text-gray-400">
                Press the suggestion button to find a meal for today.
              </p>
            </div>
          ) : (
            currentSuggestion && (
              <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                {currentSuggestion.imageUrl && (
                  <img
                    src={currentSuggestion.imageUrl}
                    alt=""
                    className="h-64 w-full object-cover"
                  />
                )}
                <div className="space-y-5 p-5">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-2xl font-bold leading-tight text-gray-900">
                        {currentSuggestion.title}
                      </h4>
                      <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700">
                        {formatTime(currentSuggestion.readyInMinutes)}
                      </span>
                    </div>
                    {currentSuggestion.summary && (
                      <p className="line-clamp-3 text-sm text-gray-500">
                        {currentSuggestion.summary}
                      </p>
                    )}
                  </div>

                  <NutritionPills meal={currentSuggestion} />

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentSuggestionIndex((currentIndex) =>
                          Math.max(0, currentIndex - 1)
                        )
                      }
                      disabled={currentSuggestionIndex === 0}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentSuggestionIndex((currentIndex) =>
                          Math.min(suggestions.length - 1, currentIndex + 1)
                        )
                      }
                      disabled={currentSuggestionIndex >= suggestions.length - 1}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddSuggestion(currentSuggestion)}
                      disabled={savingMealId === currentSuggestion.spoonacularId}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none disabled:opacity-50 sm:col-span-1"
                    >
                      {savingMealId === currentSuggestion.spoonacularId
                        ? "Adding..."
                        : "Add to Today"}
                    </button>
                    {currentSuggestion.sourceUrl && (
                      <a
                        href={currentSuggestion.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                      >
                        View
                      </a>
                    )}
                  </div>
                </div>
              </article>
            )
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-lg font-bold text-gray-900">Log a Meal</h3>
            <form onSubmit={handleLogManualMeal} className="mt-4 space-y-3">
              <input
                type="text"
                value={manualMeal.title}
                onChange={(event) =>
                  handleManualMealChange("title", event.target.value)
                }
                className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="Meal name"
              />
              <div className="grid grid-cols-2 gap-3">
                {MACRO_ITEMS.map((item) => (
                  <input
                    key={item.key}
                    type="number"
                    min="0"
                    step="0.1"
                    value={manualMeal[item.key] ?? ""}
                    onChange={(event) =>
                      handleManualMealChange(item.key, event.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder={`${item.label} (${item.unit})`}
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={loggingManualMeal}
                className="w-full rounded-lg bg-gray-900 p-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 focus:outline-none disabled:opacity-50"
              >
                {loggingManualMeal ? "Logging..." : "Log Meal"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Today's Meals</h3>
              <span className="text-xs font-semibold text-gray-400">
                {todaysMeals.length} logged
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {loadingMeals ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  Loading today's meals...
                </p>
              ) : todaysMeals.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center text-sm text-gray-400">
                  No meals logged today.
                </p>
              ) : (
                todaysMeals.map((meal) => (
                  <div
                    key={meal.id}
                    className="rounded-lg border border-gray-100 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{meal.title}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(meal.eaten_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMeal(meal.id)}
                        disabled={removingMealId === meal.id}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        {removingMealId === meal.id ? "Removing" : "Remove"}
                      </button>
                    </div>
                    <div className="mt-3">
                      <NutritionPills meal={meal} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

MealPlannerPanel.propTypes = {
  isGuest: PropTypes.bool,
  maxTime: PropTypes.number.isRequired,
  showFilters: PropTypes.bool.isRequired,
  cookingSkillOptions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  applianceOptions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  onMaxTimeChange: PropTypes.func.isRequired,
  onToggleFilters: PropTypes.func.isRequired,
  onCookingSkillChange: PropTypes.func.isRequired,
  onToggleAppliance: PropTypes.func.isRequired,
  recipeFilters: PropTypes.shape({
    cookingSkill: PropTypes.string,
    selectedAppliances: PropTypes.arrayOf(PropTypes.string),
  }),
  profile: PropTypes.shape({
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
    weight_kg: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    height_cm: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    age: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    activity_level: PropTypes.string,
    goal: PropTypes.string,
  }),
  session: PropTypes.shape({
    user: PropTypes.shape({
      id: PropTypes.string.isRequired,
    }),
  }),
};
