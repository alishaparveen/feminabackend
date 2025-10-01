#!/bin/bash

# Manual Integration Test Script for User Preferences API
# Usage: ./scripts/manual_check_preferences.sh

# Set your auth token and base URL
AUTH_TOKEN=${AUTH_TOKEN:-"YOUR_AUTH_TOKEN_HERE"}
BASE_URL=${BASE_URL:-"http://localhost:5000"}

echo "🧪 User Preferences API - Manual Integration Tests"
echo "=================================================="
echo ""
echo "Base URL: $BASE_URL"
echo "Auth Token: ${AUTH_TOKEN:0:20}..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Get user preferences (should return empty initially)
echo -e "${BLUE}Test 1: GET /api/users/me/preferences${NC}"
echo "Getting user preferences..."
curl -s -X GET \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/users/me/preferences" | jq '.'
echo ""
echo ""

# Test 2: Follow a category
echo -e "${BLUE}Test 2: POST /api/users/me/preferences/follow${NC}"
echo "Following 'Health/Mental Health' category..."
curl -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"Health/Mental Health"}' \
  "$BASE_URL/api/users/me/preferences/follow" | jq '.'
echo ""
echo ""

# Test 3: Follow another category
echo -e "${BLUE}Test 3: POST /api/users/me/preferences/follow${NC}"
echo "Following 'Career/Career Growth' category..."
curl -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"Career/Career Growth"}' \
  "$BASE_URL/api/users/me/preferences/follow" | jq '.'
echo ""
echo ""

# Test 4: Create a saved filter
echo -e "${BLUE}Test 4: POST /api/users/me/preferences/filters${NC}"
echo "Creating a saved filter for parenting stories..."
curl -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Parenting Stories",
    "type": "stories",
    "query": {
      "category": "Parenting",
      "tags": ["postpartum"],
      "sort": "newest",
      "pageSize": 12
    }
  }' \
  "$BASE_URL/api/users/me/preferences/filters" | jq '.'
echo ""
echo ""

# Test 5: Get preferences again (should show followed categories and filter)
echo -e "${BLUE}Test 5: GET /api/users/me/preferences${NC}"
echo "Getting updated preferences..."
curl -s -X GET \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/users/me/preferences" | jq '.'
echo ""
echo ""

# Test 6: Get recommended categories
echo -e "${BLUE}Test 6: GET /api/recommendations/categories${NC}"
echo "Getting recommended categories (with age 28)..."
curl -s -X GET \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/recommendations/categories?age=28" | jq '.'
echo ""
echo ""

# Test 7: Unfollow a category
echo -e "${BLUE}Test 7: POST /api/users/me/preferences/unfollow${NC}"
echo "Unfollowing 'Career/Career Growth' category..."
curl -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"Career/Career Growth"}' \
  "$BASE_URL/api/users/me/preferences/unfollow" | jq '.'
echo ""
echo ""

# Test 8: Update preferences (bulk update)
echo -e "${BLUE}Test 8: PUT /api/users/me/preferences${NC}"
echo "Updating discovery settings..."
curl -s -X PUT \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "discoverySettings": {
      "age": 28,
      "interests": ["career", "health", "parenting"]
    }
  }' \
  "$BASE_URL/api/users/me/preferences" | jq '.'
echo ""
echo ""

# Test 9: Test invalid category (should fail)
echo -e "${BLUE}Test 9: POST /api/users/me/preferences/follow (Invalid)${NC}"
echo "Attempting to follow invalid category..."
curl -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"InvalidCategory"}' \
  "$BASE_URL/api/users/me/preferences/follow" | jq '.'
echo ""
echo ""

# Test 10: Admin seed preferences (requires admin token)
# Uncomment and use admin token if testing admin endpoint
# echo -e "${BLUE}Test 10: POST /api/admin/seed-preferences (Admin)${NC}"
# echo "Seeding demo preferences for test user..."
# ADMIN_TOKEN="YOUR_ADMIN_TOKEN_HERE"
# curl -s -X POST \
#   -H "Authorization: Bearer $ADMIN_TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"uid":"test-user-uid"}' \
#   "$BASE_URL/api/admin/seed-preferences" | jq '.'
# echo ""

echo -e "${GREEN}✅ Manual tests completed!${NC}"
echo ""
echo "Quick checklist for frontend:"
echo "  ☐ Users can follow/unfollow categories"
echo "  ☐ Saved filters are created and stored"
echo "  ☐ Recommendations are personalized based on age/followed categories"
echo "  ☐ Invalid categories are rejected with clear error messages"
echo "  ☐ Admin can seed demo preferences for test users"
