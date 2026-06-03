import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";

function formatMinutes(minutes) {
  if (!minutes) return "Time varies";
  return `${minutes} mins`;
}

function formatCost(cost) {
  if (!cost) return null;
  return `Approx £${cost.toFixed(2)} per serving`;
}

function normalizeRecipe(row) {
  const estimatedCost = row.cost_estimate == null ? null : Number(row.cost_estimate);

  return {
    ...row,
    image: row.image_url,
    readyInMinutes: row.ready_in_minutes || row.prep_time_minutes,
    estimatedCost,
    dietaryTags: row.dietary_tags || [],
    extendedIngredients: row.ingredients || [],
    analyzedInstructions: row.analyzed_instructions || [],
    instructionSteps: row.instructions || [],
  };
}

export default function RecipeView({ profile }) {
  const [maxTime, setMaxTime] = useState(45);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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

        if (profile?.budget) {
          query = query.lte("cost_estimate", Number(profile.budget));
        }

        const dietaryFilters = profile?.dietary_requirements || [];

        if (dietaryFilters.length > 0) {
          query = query.contains("dietary_tags", dietaryFilters);
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
  }, [profile, maxTime]);

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
          <p className="text-sm text-gray-500">Tailored suggestions from your saved recipe database using your budget and dietary preferences.</p>
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
            onChange={(e) => setMaxTime(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-600 focus:outline-none"
          />
          <div className="flex justify-between text-xs text-gray-400 font-medium px-0.5">
            <span>10 min express</span>
            <span>2 hours max</span>
          </div>
        </div>

        {profile && (
          <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-400 font-medium">Applied limits:</span>
            {profile.budget && (
              <span className="bg-gray-100 text-gray-700 font-medium px-2 py-1 rounded">
                Max Budget: £{profile.budget}
              </span>
            )}
            {profile.dietary_requirements?.map((req) => (
              <span key={req} className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium px-2 py-1 rounded">
                {req}
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
            <p className="text-gray-400 text-sm animate-pulse">Filtering recipes matching your guidelines...</p>
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200 px-4">
            <p className="text-gray-400 font-medium">No recipes match your combined time, budget, and dietary choices.</p>
            <p className="text-xs text-gray-400 mt-1">Try extending your slider range to reveal more variations.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recipes.map((recipe) => (
              <button
                type="button"
                key={recipe.id} 
                onClick={() => setSelectedRecipeId(recipe.id)}
                className="bg-white text-left rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition duration-200 flex flex-col"
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
                  <h3 className="font-bold text-gray-900 text-lg leading-tight">{recipe.title}</h3>
                  <p className="text-sm text-gray-500 line-clamp-3">{recipe.description}</p>
                </div>
                
                {recipe.dietaryTags && recipe.dietaryTags.length > 0 && (
                  <div className="px-5 pb-4 pt-2 flex flex-wrap gap-1 border-t border-gray-50">
                    {recipe.dietaryTags.map((tag) => (
                      <span key={tag} className="bg-gray-50 text-gray-400 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

RecipeView.propTypes = {
  profile: PropTypes.shape({
    budget: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
  }),
};
