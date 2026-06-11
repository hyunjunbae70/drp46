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

const EMPTY_RECIPE_FORM = {
  title: "",
  description: "",
  prepTimeMinutes: 30,
  costEstimate: 5,
  servings: 2,
  dietaryTags: [],
  cookingSkill: "beginner",
  appliancesNeeded: [],
  ingredientsText: "",
  instructionsText: ""
};

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

function linesFromJsonList(items) {
  if (!Array.isArray(items)) return "";

  return items
    .map((item) => {
      if (typeof item === "string") return item;
      return item?.original || item?.step || "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function recipeToForm(recipe) {
  if (!recipe) return EMPTY_RECIPE_FORM;

  return {
    title: recipe.title || "",
    description: recipe.description || "",
    prepTimeMinutes: recipe.prep_time_minutes || recipe.readyInMinutes || 30,
    costEstimate: recipe.cost_estimate == null ? 5 : Number(recipe.cost_estimate),
    servings: recipe.servings || 2,
    dietaryTags: recipe.dietary_tags || recipe.dietaryTags || [],
    cookingSkill: recipe.cooking_skill || recipe.cookingSkill || "beginner",
    appliancesNeeded: recipe.appliances_needed || recipe.appliancesNeeded || [],
    ingredientsText: linesFromJsonList(recipe.ingredients || recipe.extendedIngredients),
    instructionsText: linesFromJsonList(recipe.instructions || recipe.instructionSteps)
  };
}

function buildRecipePayload(formData, userId) {
  const ingredients = parseLines(formData.ingredientsText).map((line) => ({
    original: line,
  }));
  const instructions = parseLines(formData.instructionsText).map((line, index) => ({
    number: index + 1,
    step: line,
  }));

  return {
    title: formData.title.trim(),
    description: formData.description.trim() || null,
    prep_time_minutes: Math.max(1, Number(formData.prepTimeMinutes) || 1),
    ready_in_minutes: Math.max(1, Number(formData.prepTimeMinutes) || 1),
    cost_estimate: Math.max(0, Number(formData.costEstimate) || 0),
    servings: Math.max(1, Number(formData.servings) || 1),
    dietary_tags: formData.dietaryTags,
    cooking_skill: formData.cookingSkill,
    appliances_needed: formData.appliancesNeeded,
    ingredients,
    instructions,
    user_id: userId,
    is_user_submitted: true
  };
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
    isUserSubmitted: row.is_user_submitted || false,
    ownerId: row.user_id
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

function RecipeEditor({
  formData,
  isEditing,
  loading,
  message,
  onCancel,
  onChange,
  onSubmit,
  onToggleAppliance,
  onToggleDietaryTag,
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">
            {isEditing ? "Edit Recipe" : "Add Your Recipe"}
          </h3>
          <p className="text-sm text-gray-500">
            Private recipes are only used in your own recommendations.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <label htmlFor="recipe-title" className="block text-sm font-semibold text-gray-700">
            Recipe title
          </label>
          <input
            id="recipe-title"
            required
            value={formData.title}
            onChange={(event) => onChange("title", event.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="Lentil pasta bowl"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor="recipe-description" className="block text-sm font-semibold text-gray-700">
            Description
          </label>
          <textarea
            id="recipe-description"
            value={formData.description}
            onChange={(event) => onChange("description", event.target.value)}
            rows="2"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="A quick, filling meal for busy evenings."
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="recipe-time" className="block text-sm font-semibold text-gray-700">
            Prep time
          </label>
          <input
            id="recipe-time"
            type="number"
            min="1"
            required
            value={formData.prepTimeMinutes}
            onChange={(event) => onChange("prepTimeMinutes", Number(event.target.value))}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="recipe-cost" className="block text-sm font-semibold text-gray-700">
            Cost per serving
          </label>
          <input
            id="recipe-cost"
            type="number"
            min="0"
            step="0.01"
            required
            value={formData.costEstimate}
            onChange={(event) => onChange("costEstimate", Number(event.target.value))}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="recipe-servings" className="block text-sm font-semibold text-gray-700">
            Servings
          </label>
          <input
            id="recipe-servings"
            type="number"
            min="1"
            required
            value={formData.servings}
            onChange={(event) => onChange("servings", Number(event.target.value))}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        

        <div className="space-y-2 md:col-span-2">
          <span className="block text-sm font-semibold text-gray-700">Dietary tags</span>
          <div className="flex flex-wrap gap-2">
            {(profileDietaryOptions()).map((option) => {
              const isSelected = formData.dietaryTags.includes(option.id);

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onToggleDietaryTag(option.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <span className="block text-sm font-semibold text-gray-700">Appliances</span>
          <div className="flex flex-wrap gap-2">
            {APPLIANCE_OPTIONS.map((option) => {
              const isSelected = formData.appliancesNeeded.includes(option.id);

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onToggleAppliance(option.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="recipe-skill" className="block text-sm font-semibold text-gray-700">
            Cooking skill
          </label>
          <select
            id="recipe-skill"
            value={formData.cookingSkill}
            onChange={(event) => onChange("cookingSkill", event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-gray-700 focus:border-emerald-500 focus:outline-none"
          >
            {COOKING_SKILL_OPTIONS.filter((option) => option.id !== "any").map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor="recipe-ingredients" className="block text-sm font-semibold text-gray-700">
            Ingredients
          </label>
          <textarea
            id="recipe-ingredients"
            required
            value={formData.ingredientsText}
            onChange={(event) => onChange("ingredientsText", event.target.value)}
            rows="5"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder={"1 tin chickpeas\n1 tbsp olive oil\n2 handfuls spinach"}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label htmlFor="recipe-instructions" className="block text-sm font-semibold text-gray-700">
            Instructions
          </label>
          <textarea
            id="recipe-instructions"
            required
            value={formData.instructionsText}
            onChange={(event) => onChange("instructionsText", event.target.value)}
            rows="5"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder={"Warm the oil in a pan.\nAdd chickpeas and cook for 5 minutes.\nFold in spinach and serve."}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "Saving..." : isEditing ? "Save recipe" : "Add recipe"}
        </button>
        {message && (
          <p className="text-sm font-medium text-gray-600">{message}</p>
        )}
      </div>
    </form>
  );
}

function profileDietaryOptions() {
  return [
    { id: "vegan", label: "Vegan" },
    { id: "vegetarian", label: "Vegetarian" },
    { id: "gluten-free", label: "Gluten-Free" },
    { id: "dairy-free", label: "Dairy-Free" },
    { id: "halal", label: "Halal" },
    { id: "kosher", label: "Kosher" },
  ];
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
  const [showRecipeEditor, setShowRecipeEditor] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [recipeForm, setRecipeForm] = useState(() => ({ ...EMPTY_RECIPE_FORM }));
  const [recipeFormLoading, setRecipeFormLoading] = useState(false);
  const [recipeFormMessage, setRecipeFormMessage] = useState("");
  const [showMineOnly, setShowMineOnly] = useState(false);
  const [recipeRefreshToken, setRecipeRefreshToken] = useState(0);
  const [activeTab, setActiveTab] = useState("recipes");
  const [showFilters, setShowFilters] = useState(false);
  const userId = session?.user?.id;

  useEffect(() => {
    let isCurrent = true;

    async function fetchRecommendations() {
      setLoading(true);
      setError("");
      try {
        let query = supabase
          .from("recipes")
          .select("*")
          .order("health_score", { ascending: false, nullsFirst: false })
          .limit(60);

        if (!showMineOnly) {
          query = query.lte("prep_time_minutes", maxTime);
        }

        if (!showMineOnly && hasBudgetLimit(profile)) {
          query = query.lte("cost_estimate", Number(profile.budget));
        }

        const dietaryFilters = profile?.dietary_requirements || [];

        if (!showMineOnly && dietaryFilters.length > 0) {
          query = query.contains("dietary_tags", dietaryFilters);
        }

        if (!showMineOnly && cookingSkill !== "any") {
          query = query.eq("cooking_skill", cookingSkill);
        }

        if (!showMineOnly && selectedAppliances.length > 0) {
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
  }, [profile, maxTime, cookingSkill, selectedAppliances, userId, showMineOnly, recipeRefreshToken]);

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
    () => recipes.filter((recipe) => {
      if (showFavouritesOnly && !savedMealIds.includes(recipe.id)) return false;
      if (showMineOnly && recipe.ownerId !== userId) return false;
      return true;
    }),
    [recipes, savedMealIds, showFavouritesOnly, showMineOnly, userId]
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

  const closeRecipeEditor = () => {
    setShowRecipeEditor(false);
    setEditingRecipe(null);
    setRecipeForm({ ...EMPTY_RECIPE_FORM });
    setRecipeFormMessage("");
  };

  const openNewRecipeEditor = () => {
    setEditingRecipe(null);
    setRecipeForm({ ...EMPTY_RECIPE_FORM });
    setRecipeFormMessage("");
    setShowRecipeEditor(true);
  };

  const openEditRecipeEditor = (recipe) => {
    setEditingRecipe(recipe);
    setRecipeForm(recipeToForm(recipe));
    setRecipeFormMessage("");
    setShowRecipeEditor(true);
  };

  const updateRecipeForm = (field, value) => {
    setRecipeForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const toggleRecipeFormArrayValue = (field, value) => {
    setRecipeForm((current) => {
      const values = current[field];
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];

      return {
        ...current,
        [field]: nextValues,
      };
    });
  };

  const handleRecipeSubmit = async (event) => {
    event.preventDefault();

    if (!userId) {
      setRecipeFormMessage("Sign in to add your own recipes.");
      return;
    }

    if (parseLines(recipeForm.ingredientsText).length === 0 || parseLines(recipeForm.instructionsText).length === 0) {
      setRecipeFormMessage("Add at least one ingredient and one instruction.");
      return;
    }

    setRecipeFormLoading(true);
    setRecipeFormMessage("");

    try {
      const payload = buildRecipePayload(recipeForm, userId);
      const request = editingRecipe
        ? supabase
          .from("recipes")
          .update(payload)
          .eq("id", editingRecipe.id)
          .eq("user_id", userId)
        : supabase.from("recipes").insert(payload);

      const { error: recipeError } = await request;
      if (recipeError) throw recipeError;

      setRecipeFormMessage(editingRecipe ? "Recipe updated." : "Recipe added.");
      setRecipeRefreshToken((current) => current + 1);
      closeRecipeEditor();
    } catch (err) {
      setRecipeFormMessage(err instanceof Error ? err.message : "Unable to save recipe.");
    } finally {
      setRecipeFormLoading(false);
    }
  };

  const handleRecipeDelete = async (recipe) => {
    if (!userId || recipe.ownerId !== userId) return;

    setSaveMessage("");
    const { error: deleteError } = await supabase
      .from("recipes")
      .delete()
      .eq("id", recipe.id)
      .eq("user_id", userId);

    if (deleteError) {
      setSaveMessage(deleteError.message || "Unable to delete recipe.");
      return;
    }

    setSavedMealIds((current) => current.filter((id) => id !== recipe.id));
    setRecipeRefreshToken((current) => current + 1);
    setSaveMessage("Recipe deleted.");
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
              {selectedRecipe.ownerId === userId && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      openEditRecipeEditor(selectedRecipe);
                      setSelectedRecipeId(null);
                    }}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Edit recipe
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await handleRecipeDelete(selectedRecipe);
                      setSelectedRecipeId(null);
                    }}
                    className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    Delete recipe
                  </button>
                </>
              )}
            </div>


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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Recipe Discoverer</h2>
            <p className="text-sm text-gray-500">
              {profile
                ? `Tailored suggestions from your saved recipe database using your ${isGuest ? "temporary" : "saved"} budget and dietary preferences.`
                : "Browse suggestions from the saved recipe database. Sign in to apply your budget and dietary preferences."}
            </p>
          </div>

          {!isGuest && userId && (
            <button
              type="button"
              onClick={openNewRecipeEditor}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none"
            >
              Add your own recipe
            </button>
          )}
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

        <button
          type="button"
          onClick={() => setShowFilters((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none w-fit"
        >
          <span>{showFilters ? "Hide filters" : "More filters"}</span>
          <svg
            className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showFilters && (
          <div className="space-y-4 pt-2 border-t border-gray-100">
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
                  Appliances you have
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
              {!isGuest && userId && (
                <button
                  type="button"
                  onClick={() => setShowMineOnly((current) => !current)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition focus:outline-none ${
                    showMineOnly
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {showMineOnly ? "Showing my recipes" : "Show my recipes"}
                </button>
              )}
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
        )}
      </div>

      {showRecipeEditor && (
        <RecipeEditor
          formData={recipeForm}
          isEditing={Boolean(editingRecipe)}
          loading={recipeFormLoading}
          message={recipeFormMessage}
          onCancel={closeRecipeEditor}
          onChange={updateRecipeForm}
          onSubmit={handleRecipeSubmit}
          onToggleAppliance={(value) => toggleRecipeFormArrayValue("appliancesNeeded", value)}
          onToggleDietaryTag={(value) => toggleRecipeFormArrayValue("dietaryTags", value)}
        />
      )}

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
            <p className="text-gray-400 font-medium">
              {showMineOnly
                ? "You have not added any recipes yet."
                : "No favourites match your current filters."}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {showMineOnly
                ? "Add a recipe to build your personal collection."
                : "Save a recipe as a favourite or turn off the favourites filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
              {[
                { id: "recipes", label: `All recipes (${visibleRecipes.length})` },
                { id: "combos", label: "Meal combos" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none ${
                    activeTab === tab.id
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {saveMessage && (
              <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                {saveMessage}
              </p>
            )}

            {activeTab === "combos" && (
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
            )}

            {activeTab === "recipes" && (
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
                        <div className="flex flex-wrap gap-1">
                          <span className="bg-gray-100 text-gray-800 text-xs font-bold px-2 py-1 rounded">
                            {formatMinutes(recipe.readyInMinutes)}
                          </span>
                          {recipe.ownerId === userId && (
                            <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2 py-1 rounded">
                              Mine
                            </span>
                          )}
                        </div>
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
                      <div className="grid grid-cols-1 gap-2">
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
                        {recipe.ownerId === userId && (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => openEditRecipeEditor(recipe)}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRecipeDelete(recipe)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
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
