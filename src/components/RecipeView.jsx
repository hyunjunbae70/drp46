import { useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";

// Metric tracking functionality
import { trackStep, completeJourney, persistJourney } from "../analytics";

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

const GUEST_FAVORITES_KEY = "nutrisupport_guest_favourites";
const MEALS_PER_COMBINATION = 3;

function formatMinutes(minutes) {
  if (!minutes) return "Time varies";
  return `${minutes} mins`;
}

function formatCost(cost) {
  if (!cost) return null;
  return `Approx £${cost.toFixed(2)} per serving`;
}

function readStoredIds(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function writeStoredIds(key, ids) {
  window.localStorage.setItem(key, JSON.stringify(ids));
}

function average(values) {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (validValues.length === 0) return null;
  return validValues.reduce((total, value) => total + value, 0) / validValues.length;
}

function normalizeRecipe(row) {
  const estimatedCost = row.cost_estimate == null ? null : Number(row.cost_estimate);

  return {
    ...row,
    image: row.image_url,
    readyInMinutes: row.ready_in_minutes || row.prep_time_minutes,
    estimatedCost,
    healthScore: row.health_score == null ? null : Number(row.health_score),
    calories: row.calories == null ? null : Number(row.calories),
    proteinGrams: row.protein_grams == null ? null : Number(row.protein_grams),
    carbsGrams: row.carbs_grams == null ? null : Number(row.carbs_grams),
    fatGrams: row.fat_grams == null ? null : Number(row.fat_grams),
    cookingSkill: row.cooking_skill,
    appliancesNeeded: row.appliances_needed || [],
    dietaryTags: row.dietary_tags || [],
    extendedIngredients: row.ingredients || [],
    analyzedInstructions: row.analyzed_instructions || [],
    instructionSteps: row.instructions || [],
  };
}

function hasBudgetLimit(profile) {
  return profile?.budget !== undefined && profile?.budget !== null && profile.budget !== "";
}

function isMissingPersistenceTable(error) {
  return error?.code === "PGRST205" || error?.message?.includes("schema cache");
}

function buildMealCombinations(recipes, offset) {
  if (recipes.length === 0) return [];

  const rotatedRecipes = recipes.map((_, index) => recipes[(index + offset) % recipes.length]);
  const combinations = [];

  for (let index = 0; index < rotatedRecipes.length; index += MEALS_PER_COMBINATION) {
    const meals = rotatedRecipes.slice(index, index + MEALS_PER_COMBINATION);
    if (meals.length < MEALS_PER_COMBINATION) break;

    const tagCount = new Set(meals.flatMap((meal) => meal.dietaryTags)).size;
    const averageHealth = average(meals.map((meal) => meal.healthScore));
    const averageCalories = average(meals.map((meal) => meal.calories));
    const averageProtein = average(meals.map((meal) => meal.proteinGrams));
    const totalCost = meals.reduce((total, meal) => total + (meal.estimatedCost || 0), 0);
    const balanceScore = Math.round((averageHealth || 0) + tagCount * 3);

    combinations.push({
      id: meals.map((meal) => meal.id).join("-"),
      meals,
      averageHealth,
      averageCalories,
      averageProtein,
      balanceScore,
      totalCost,
      tagCount,
    });
  }

  return combinations.sort((a, b) => b.balanceScore - a.balanceScore).slice(0, 6);
}

export default function RecipeView({ profile, session, isGuest = false }) {
  const [maxTime, setMaxTime] = useState(45);
  const [cookingSkill, setCookingSkill] = useState("any");
  const [selectedAppliances, setSelectedAppliances] = useState([]);
  const [recommendationOffset, setRecommendationOffset] = useState(0);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedMealIds, setSavedMealIds] = useState([]);
  const [showFavouritesOnly, setShowFavouritesOnly] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    let isCurrent = true;

    async function fetchRecommendations() {
      setLoading(true);
      setError("");
      try {
        let query = supabase
          .from("recipes")
          .select("*")
          .lte("prep_time_minutes", maxTime)
          .order("health_score", { ascending: false, nullsFirst: false })
          .limit(60);

        if (hasBudgetLimit(profile)) {
          query = query.lte("cost_estimate", Number(profile.budget));
        }

        const dietaryFilters = profile?.dietary_requirements || [];

        if (dietaryFilters.length > 0) {
          query = query.contains("dietary_tags", dietaryFilters);
        }

        if (cookingSkill !== "any") {
          query = query.eq("cooking_skill", cookingSkill);
        }

        if (selectedAppliances.length > 0) {
          query = query.contains("appliances_needed", selectedAppliances);
        }

        const { data, error: queryError } = await query;
        if (queryError) throw queryError;

        if (isCurrent) {
          setRecipes((data || []).map(normalizeRecipe));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load recipes.";
        console.error("Error querying recipe recommendations:", message);
        if (isCurrent) {
          setError(message);
          setRecipes([]);
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    }

    fetchRecommendations();

    return () => {
      isCurrent = false;
    };
  }, [profile, maxTime, cookingSkill, selectedAppliances]);

  useEffect(() => {
    let isCurrent = true;

    async function fetchSavedMeals() {
      if (isGuest) {
        setSavedMealIds(readStoredIds(GUEST_FAVORITES_KEY));
        return;
      }

      if (!session?.user?.id) {
        setSavedMealIds([]);
        return;
      }

      const { data: favourites, error: favouritesError } = await supabase
        .from("user_favourite_recipes")
        .select("recipe_id")
        .eq("user_id", session.user.id);

      if (!isCurrent) return;

      if (favouritesError) {
        if (isMissingPersistenceTable(favouritesError)) {
          setSavedMealIds([]);
          return;
        }

        setSaveMessage(favouritesError.message || "Unable to load saved meals.");
        return;
      }

      setSavedMealIds((favourites || []).map((row) => row.recipe_id));
    }

    fetchSavedMeals();

    return () => {
      isCurrent = false;
    };
  }, [isGuest, session]);

  const visibleRecipes = useMemo(
    () => showFavouritesOnly
      ? recipes.filter((recipe) => savedMealIds.includes(recipe.id))
      : recipes,
    [recipes, savedMealIds, showFavouritesOnly]
  );

  const mealCombinations = useMemo(
    () => buildMealCombinations(visibleRecipes, recommendationOffset),
    [visibleRecipes, recommendationOffset]
  );

  const toggleFavourite = async (recipeId) => {
    const isSaved = savedMealIds.includes(recipeId);
    const nextIds = isSaved
      ? savedMealIds.filter((id) => id !== recipeId)
      : [...savedMealIds, recipeId];

    setSavedMealIds(nextIds);
    setSaveMessage(isSaved ? "Removed from favourites." : "Saved to favourites.");

    if (isGuest) {
      writeStoredIds(GUEST_FAVORITES_KEY, nextIds);
      return;
    }

    if (!session?.user?.id) return;

    const { error: saveError } = isSaved
      ? await supabase
        .from("user_favourite_recipes")
        .delete()
        .eq("user_id", session.user.id)
        .eq("recipe_id", recipeId)
      : await supabase
        .from("user_favourite_recipes")
        .upsert({ user_id: session.user.id, recipe_id: recipeId });

    if (saveError) {
      setSavedMealIds(savedMealIds);
      setSaveMessage(
        isMissingPersistenceTable(saveError)
          ? "Create the saved meals tables in Supabase to save favourites while signed in."
          : saveError.message
      );
    }
  };

  useEffect(() => {
    if (!selectedRecipeId) return undefined;

    let isCurrent = true;

    async function fetchRecipeDetail() {
      setDetailLoading(true);
      setDetailError("");
      setSelectedRecipe(null);

      try {
        const { data, error: queryError } = await supabase
          .from("recipes")
          .select("*")
          .eq("id", selectedRecipeId)
          .single();

        if (queryError) throw queryError;

        if (isCurrent) {
          setSelectedRecipe(normalizeRecipe(data));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load this recipe.";
        console.error("Error loading recipe:", message);
        if (isCurrent) {
          setDetailError(message);
        }
      } finally {
        if (isCurrent) {
          setDetailLoading(false);
        }
      }
    }

    fetchRecipeDetail();

    return () => {
      isCurrent = false;
    };
  }, [selectedRecipeId]);

  if (selectedRecipeId) {
    const steps = selectedRecipe?.instructionSteps?.length > 0
      ? selectedRecipe.instructionSteps.map((step) => step.step || step)
      : selectedRecipe?.analyzedInstructions?.flatMap((section) =>
        section.steps?.map((step) => step.step) || []
      ) || [];

    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => {
            setSelectedRecipeId(null);
            setSelectedRecipe(null);
            setDetailError("");
          }}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Back to recipes
        </button>

        {detailLoading ? (
          <div className="flex justify-center items-center py-16">
            <p className="text-gray-400 text-sm animate-pulse">Loading the full recipe...</p>
          </div>
        ) : detailError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {detailError}
          </div>
        ) : selectedRecipe ? (
          <article className="space-y-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-start">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                  {selectedRecipe.dietaryTags.map((tag) => (
                    <span key={tag} className="rounded bg-emerald-50 px-2 py-1">
                      {tag}
                    </span>
                  ))}
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-gray-950">
                  {selectedRecipe.title}
                </h1>
                {selectedRecipe.description && (
                  <p className="max-w-3xl text-base leading-7 text-gray-600">
                    {selectedRecipe.description}
                  </p>
                )}
              </div>

              {selectedRecipe.image && (
                <img
                  src={selectedRecipe.image}
                  alt={selectedRecipe.title}
                  className="aspect-[4/3] w-full rounded-lg object-cover shadow-sm"
                />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ready In</p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  {formatMinutes(selectedRecipe.readyInMinutes)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Servings</p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  {selectedRecipe.servings || "Flexible"}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Estimated Cost</p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  {formatCost(selectedRecipe.estimatedCost) || "Not listed"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              {selectedRecipe.cookingSkill && (
                <span className="rounded bg-blue-50 px-3 py-1 font-medium text-blue-700">
                  {selectedRecipe.cookingSkill} skill
                </span>
              )}
              {selectedRecipe.appliancesNeeded.map((appliance) => (
                <span key={appliance} className="rounded bg-gray-100 px-3 py-1 font-medium text-gray-700">
                  {appliance}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => toggleFavourite(selectedRecipe.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  savedMealIds.includes(selectedRecipe.id)
                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {savedMealIds.includes(selectedRecipe.id) ? "Favourited" : "Save favourite"}
              </button>
            </div>

            {saveMessage && (
              <p className="text-sm font-medium text-emerald-700">{saveMessage}</p>
            )}

            {selectedRecipe.extendedIngredients?.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xl font-bold text-gray-900">Ingredients</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {selectedRecipe.extendedIngredients.map((ingredient) => (
                    <li
                      key={`${ingredient.id}-${ingredient.original}`}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700"
                    >
                      {ingredient.original}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-xl font-bold text-gray-900">Instructions</h2>
              {steps.length > 0 ? (
                <ol className="space-y-3">
                  {steps.map((step, index) => (
                    <li key={`${index}-${step}`} className="flex gap-3 rounded-lg bg-white p-4 shadow-sm border border-gray-200">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                        {index + 1}
                      </span>
                      <span className="text-sm leading-6 text-gray-700">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-500">
                  This recipe does not include step-by-step instructions yet.
                </p>
              )}
            </section>
          </article>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Recipe Discoverer</h2>
          <p className="text-sm text-gray-500">
            {profile
              ? `Tailored suggestions from your saved recipe database using your ${isGuest ? "temporary" : "saved"} budget and dietary preferences.`
              : "Browse suggestions from the saved recipe database. Sign in to apply your budget and dietary preferences."}
          </p>
        </div>

        <div className="max-w-md space-y-2">
          <div className="flex justify-between items-center text-sm">
            <label htmlFor="time-range" className="font-semibold text-gray-700">Available Cooking Time:</label>
            <span className="bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full text-xs">
              {maxTime} minutes or less
            </span>
          </div>
          <input
            id="time-range"
            type="range"
            min="10"
            max="120"
            step="5"
            value={maxTime}
            onChange={(e) => {
              trackStep("changed_time_filter")
              setMaxTime(Number(e.target.value));
            }}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-600 focus:outline-none"
          />
          <div className="flex justify-between text-xs text-gray-400 font-medium px-0.5">
            <span>10 min express</span>
            <span>2 hours max</span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="skill-filter" className="block text-sm font-semibold text-gray-700">
              Cooking skill
            </label>
            <select
              id="skill-filter"
              value={cookingSkill}
              onChange={(e) => setCookingSkill(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-gray-700 focus:border-emerald-500 focus:outline-none"
            >
              {COOKING_SKILL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-semibold text-gray-700">
              Appliances needed
            </span>
            <div className="flex flex-wrap gap-2">
              {APPLIANCE_OPTIONS.map((option) => {
                const isSelected = selectedAppliances.includes(option.id);

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setSelectedAppliances((current) =>
                        isSelected
                          ? current.filter((appliance) => appliance !== option.id)
                          : [...current, option.id]
                      )
                    }
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

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowFavouritesOnly((current) => !current)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition focus:outline-none ${
              showFavouritesOnly
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {showFavouritesOnly ? "Showing favourites" : `Show favourites (${savedMealIds.length})`}
          </button>
        </div>

        {profile && (
          <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-400 font-medium">Applied limits:</span>
            {hasBudgetLimit(profile) && (
              <span className="bg-gray-100 text-gray-700 font-medium px-2 py-1 rounded">
                Max Budget: £{profile.budget}
              </span>
            )}
            {profile.dietary_requirements?.map((req) => (
              <span key={req} className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium px-2 py-1 rounded">
                {req}
              </span>
            ))}
            {cookingSkill !== "any" && (
              <span className="bg-blue-50 text-blue-700 border border-blue-100 font-medium px-2 py-1 rounded">
                Skill: {cookingSkill}
              </span>
            )}
            {selectedAppliances.map((appliance) => (
              <span key={appliance} className="bg-gray-100 text-gray-700 font-medium px-2 py-1 rounded">
                {appliance}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        {error ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : loading ? (
          <div className="flex justify-center items-center py-16">
            <p className="text-gray-400 text-sm animate-pulse">
              {profile ? "Filtering recipes matching your guidelines..." : "Loading recipes..."}
            </p>
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200 px-4">
            <p className="text-gray-400 font-medium">
              {profile
                ? "No recipes match your combined time, budget, dietary, skill, and appliance choices."
                : "No recipes match the selected cooking time."}
            </p>
            <p className="text-xs text-gray-400 mt-1">Try extending your slider range to reveal more variations.</p>
          </div>
        ) : visibleRecipes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200 px-4">
            <p className="text-gray-400 font-medium">No favourites match your current filters.</p>
            <p className="text-xs text-gray-400 mt-1">Save a recipe as a favourite or turn off the favourites filter.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Balanced meal combinations</h3>
                  <p className="text-sm text-gray-500">
                    Multiple meals grouped by health score, variety, time, cost, and your active filters.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRecommendationOffset((current) => current + MEALS_PER_COMBINATION)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none"
                >
                  Try another set
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-3">
                {mealCombinations.map((combination) => (
                  <article
                    key={combination.id}
                    className="min-w-[300px] max-w-sm flex-1 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-gray-900">Meal combo</h4>
                        <p className="text-xs text-gray-500">
                          Balance score {combination.balanceScore}
                        </p>
                      </div>
                      {combination.totalCost > 0 && (
                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700">
                          £{combination.totalCost.toFixed(2)}
                        </span>
                      )}
                    </div>

                    <div className="space-y-3">
                      {combination.meals.map((meal) => (
                        <div key={meal.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                          <button
                            type="button"
                            onClick={() => {
                              trackStep("opened_recipe_from_meal_combo");
                              const metrics = completeJourney(meal.id);
                              persistJourney(metrics, supabase, session?.user?.id);
                              console.log(metrics);
                              setSelectedRecipeId(meal.id);
                            }}
                            className="text-left text-sm font-bold text-gray-900 hover:text-emerald-700"
                          >
                            {meal.title}
                          </button>
                          <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                            <span className="rounded bg-white px-1.5 py-0.5">
                              {formatMinutes(meal.readyInMinutes)}
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

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <span>Avg health: {combination.averageHealth?.toFixed(0) || "N/A"}</span>
                      <span>Variety: {combination.tagCount} tags</span>
                      <span>Calories: {combination.averageCalories?.toFixed(0) || "N/A"}</span>
                      <span>Protein: {combination.averageProtein?.toFixed(0) || "N/A"}g</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {saveMessage && (
              <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                {saveMessage}
              </p>
            )}

            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleRecipes.map((recipe) => (
              <article
                key={recipe.id} 
                className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm transition duration-200 flex flex-col"
              >
                {recipe.image && (
                  <img
                    src={recipe.image}
                    alt={recipe.title}
                    className="h-36 w-full object-cover"
                    loading="lazy"
                  />
                )}

                <div className="p-5 space-y-3 flex-1">
                  <div className="flex justify-between items-start gap-2">
                    <span className="bg-gray-100 text-gray-800 text-xs font-bold px-2 py-1 rounded">
                      {formatMinutes(recipe.readyInMinutes)}
                    </span>
                    {recipe.estimatedCost && (
                      <span className="text-xs text-gray-500 font-semibold mt-1">
                        £{recipe.estimatedCost.toFixed(2)} / serving
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      trackStep("opened_recipe_from_grid");
                      const metrics = completeJourney(recipe.id);
                      persistJourney(metrics, supabase, session?.user?.id);
                      console.log(metrics)
                      setSelectedRecipeId(recipe.id);
                    }}
                    className="text-left font-bold text-gray-900 text-lg leading-tight hover:text-emerald-700 focus:outline-none"
                  >
                    {recipe.title}
                  </button>
                  <p className="text-sm text-gray-500 line-clamp-3">{recipe.description}</p>
                </div>
                
                {(recipe.cookingSkill || recipe.appliancesNeeded.length > 0 || recipe.dietaryTags.length > 0) && (
                  <div className="px-5 pb-4 pt-2 flex flex-wrap gap-1 border-t border-gray-50">
                    {recipe.cookingSkill && (
                      <span className="bg-blue-50 text-blue-500 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded">
                        {recipe.cookingSkill}
                      </span>
                    )}
                    {recipe.appliancesNeeded.map((appliance) => (
                      <span key={appliance} className="bg-gray-50 text-gray-400 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded">
                        {appliance}
                      </span>
                    ))}
                    {recipe.dietaryTags.map((tag) => (
                      <span key={tag} className="bg-gray-50 text-gray-400 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="px-5 pb-5 pt-1">
                  <button
                    type="button"
                    onClick={() => toggleFavourite(recipe.id)}
                    className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition ${
                      savedMealIds.includes(recipe.id)
                        ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {savedMealIds.includes(recipe.id) ? "Favourited" : "Favourite"}
                  </button>
                </div>
              </article>
            ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

RecipeView.propTypes = {
  isGuest: PropTypes.bool,
  profile: PropTypes.shape({
    budget: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
  }),
};
