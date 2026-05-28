import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import AuthView from "./components/AuthView";
import ProfileView from "./components/ProfileView";
import RecipeView from "./components/RecipeView"; // Make sure to create this file next

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState("profile"); // "profile" or "recipes"
  const [profileData, setProfileData] = useState(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch or update local profile configurations whenever the session activates
  useEffect(() => {
    if (session) {
      fetchUserProfile();
    } else {
      setProfileData(null);
    }
  }, [session]);

  const fetchUserProfile = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles") // Matches your Supabase profiles table
        .select("dietary_requirements, budget") // Pull whatever metrics you store
        .eq("id", session.user.id)
        .single();

      if (error) throw error;
      if (data) setProfileData(data);
    } catch (err) {
      console.error("Error fetching sync preferences:", err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 animate-pulse">Loading...</p>
      </div>
    );
  }

  // Unauthenticated view remains centered and clean
  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
        <AuthView />
      </main>
    );
  }

  // Authenticated Dashboard Layout
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      {/* Skeleton Header Navigation */}
      <nav className="w-full bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <span className="text-xl font-bold text-emerald-600 tracking-tight">NutriSupport</span>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentView("profile")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              currentView === "profile" 
                ? "bg-emerald-50 text-emerald-700" 
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Profile Settings
          </button>
          <button
            onClick={() => setCurrentView("recipes")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              currentView === "recipes" 
                ? "bg-emerald-50 text-emerald-700" 
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Find Recipes
          </button>
          <button
            onClick={() => {
              supabase.auth.signOut();
              setSession(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* View Injection Viewport */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-6">
  {currentView === "profile" ? (
    <div className="flex w-full justify-center items-start pt-8"> 
      <div className="w-full max-w-xl"> {/* Limits the width so it doesn't stretch */}
        <ProfileView 
          session={session} 
          onSignOut={() => setSession(null)} 
          onProfileUpdate={fetchUserProfile} 
        />
      </div>
    </div>
  ) : (
    <RecipeView profile={profileData} />
  )}
</main>
    </div>
  );
}
