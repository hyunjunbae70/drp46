import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function RecipeView({ profile }) {
  const [maxTime, setMaxTime] = useState(45); // Initial state: 45 minutes
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchRecommendations();
  }, [profile, maxTime]); // Triggers database query instantly whenever profile loads or user drags the slider

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      // Base Query: Get recipes that take less than or equal to the slider time limit
      let query = supabase
        .from("recipes")
        .select("*")
        .lte("prep_time_minutes", maxTime);

      // Apply budget filtering if it exists on the profile
      if (profile?.budget) {
        query = query.lte("cost_estimate", profile.budget);
      }

      const { data, error } = await query;
      if (error) throw error;

      let processedRecipes = data || [];

      // Apply client-side filtering if you save dietary preferences as an array of tags
      if (profile?.dietary_requirements && profile.dietary_requirements.length > 0) {
        processedRecipes = processedRecipes.filter((recipe) =>
          profile.dietary_requirements.every((req) => 
            recipe.dietary_tags?.includes(req)
          )
        );
      }

      setRecipes(processedRecipes);
    } catch (err) {
      console.error("Error querying recommendations:", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Interactive Control Dashboard Widget */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Recipe Discoverer</h2>
          <p className="text-sm text-gray-500">Tailored suggestions syncing directly with your budget and dietary metrics.</p>
        </div>

        {/* The Time Constraint Range Slider */}
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

        {/* Profile Constraints Badge Indicators */}
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

      {/* Output Render Matrix */}
      <div>
        {loading ? (
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
              <div 
                key={recipe.id} 
                className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition duration-200 flex flex-col justify-between"
              >
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="bg-gray-100 text-gray-800 text-xs font-bold px-2 py-1 rounded">
                      ⏱ {recipe.prep_time_minutes} mins
                    </span>
                    {recipe.cost_estimate && (
                      <span className="text-xs text-gray-500 font-semibold mt-1">
                        Est: £{recipe.cost_estimate}
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg leading-tight">{recipe.title}</h3>
                  <p className="text-sm text-gray-500 line-clamp-3">{recipe.description}</p>
                </div>
                
                {/* Visual footer representing matching tags */}
                {recipe.dietary_tags && recipe.dietary_tags.length > 0 && (
                  <div className="px-5 pb-4 pt-2 flex flex-wrap gap-1 border-t border-gray-50">
                    {recipe.dietary_tags.map((tag) => (
                      <span key={tag} className="bg-gray-50 text-gray-400 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
