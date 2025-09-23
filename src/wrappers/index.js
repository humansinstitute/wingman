function selectWrapper(recipeConfig = null) {
  if (recipeConfig && Array.isArray(recipeConfig.sub_recipes) && recipeConfig.sub_recipes.length > 0) {
    return require('./sub-recipe-wrapper');
  }
  return require('./session-aware-wrapper');
}

module.exports = {
  selectWrapper,
  SessionAwareWrapper: require('./session-aware-wrapper'),
  SubRecipeWrapper: require('./sub-recipe-wrapper')
};

