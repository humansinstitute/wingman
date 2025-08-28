#!/bin/bash

set -e

# Colors for better visibility
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

clear_screen() {
    clear
}

print_header() {
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${WHITE}                     PROJECT MENU SYSTEM                      ${BLUE}║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo
    
    # Show current context
    local current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    local current_dir=$(basename "$PWD")
    echo -e "${CYAN}Project:${NC} ${current_dir}  ${CYAN}Branch:${NC} ${current_branch}"
    
    # Check if we're in a worktree
    local is_worktree=$(git rev-parse --git-dir 2>/dev/null | grep -q '/.git/worktrees/' && echo "yes" || echo "")
    if [[ -n "$is_worktree" ]]; then
        echo -e "${PURPLE}Worktree:${NC} $(pwd)"
    fi
    echo
}

show_main_menu() {
    print_header
    echo -e "${WHITE}Main Menu:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Switch Worktree"
    echo -e "${GREEN}2.${NC} Create New Worktree" 
    echo -e "${GREEN}3.${NC} Delete Worktree"
    echo -e "${GREEN}4.${NC} Run Scripts"
    echo -e "${GREEN}5.${NC} Git Operations"
    echo -e "${GREEN}6.${NC} Database Operations"
    echo -e "${GREEN}7.${NC} Launch Claude Code"
    echo -e "${GREEN}8.${NC} Launch Editor"
    echo -e "${GREEN}9.${NC} Project Info"
    echo -e "${GREEN}10.${NC} PR Review"
    echo
    echo -e "${RED}0.${NC} Exit"
    echo
    echo -n "Select option [0-10]: "
}

show_scripts_menu() {
    clear_screen
    print_header
    echo -e "${WHITE}Available Scripts:${NC}"
    echo
    
    # Parse package.json scripts - try jq first, fallback to grep/sed
    local scripts=""
    if command -v jq >/dev/null 2>&1; then
        scripts=$(jq -r '.scripts | to_entries[] | "\(.key)|\(.value)"' package.json 2>/dev/null)
    else
        # Fallback parsing without jq
        scripts=$(grep -A 20 '"scripts"' package.json | sed -n '/".*":/p' | sed 's/.*"\([^"]*\)": *"\([^"]*\)".*/\1|\2/' | head -20)
    fi
    
    if [[ -z "$scripts" ]]; then
        echo -e "${RED}No scripts found in package.json${NC}"
        echo
        echo -n "Press Enter to return to main menu..."
        read
        return
    fi
    
    local count=1
    local script_names=()
    
    while IFS='|' read -r name command; do
        [[ -z "$name" ]] && continue
        echo -e "${GREEN}${count}.${NC} ${CYAN}${name}${NC} - ${command}"
        script_names+=("$name")
        ((count++))
    done <<< "$scripts"
    
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select script to run [0-${#script_names[@]}]: "
    
    read choice
    if [[ "$choice" == "0" ]]; then
        return
    elif [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "${#script_names[@]}" ]]; then
        local script_name="${script_names[$((choice-1))]}"
        echo
        echo -e "${YELLOW}Running: npm run $script_name${NC}"
        echo
        npm run "$script_name"
        echo
        echo -n "Press Enter to continue..."
        read
    else
        echo -e "${RED}Invalid choice!${NC}"
        sleep 1
    fi
}

show_worktree_menu() {
    clear_screen
    print_header
    echo -e "${WHITE}Switch Worktree:${NC}"
    echo
    
    local worktrees=$(git worktree list 2>/dev/null)
    if [[ -z "$worktrees" ]]; then
        echo -e "${RED}No worktrees found${NC}"
        echo -n "Press Enter to continue..."
        read
        return
    fi
    
    echo "$worktrees"
    echo
    local count=1
    local worktree_paths=()
    
    while IFS= read -r line; do
        local path=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $2}' | tr -d '[]')
        worktree_paths+=("$path")
        echo -e "${GREEN}${count}.${NC} ${CYAN}${branch}${NC} - ${path}"
        ((count++))
    done <<< "$worktrees"
    
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select worktree [0-$((count-1))]: "
    
    read choice
    if [[ "$choice" == "0" ]]; then
        return
    elif [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -lt "$count" ]]; then
        local target_path="${worktree_paths[$((choice-1))]}"
        echo
        echo -e "${YELLOW}Switching to: $target_path${NC}"
        echo
        
        # Check if we can copy to clipboard
        local cd_command="cd $target_path"
        if command -v pbcopy >/dev/null 2>&1; then
            echo "$cd_command" | pbcopy
            echo -e "${GREEN}Command copied to clipboard!${NC}"
        elif command -v xclip >/dev/null 2>&1; then
            echo "$cd_command" | xclip -selection clipboard
            echo -e "${GREEN}Command copied to clipboard!${NC}"
        fi
        
        echo -e "${WHITE}Choose an option:${NC}"
        echo -e "${GREEN}1.${NC} Launch new shell in worktree"
        echo -e "${GREEN}2.${NC} Show cd command to copy manually"
        echo -e "${GREEN}3.${NC} Return to menu"
        echo
        echo -e "${CYAN}Tip: For direct switching, source worktree-functions.sh${NC}"
        echo -e "${CYAN}     Then use: wt <branch-name>${NC}"
        echo
        echo -n "Select option [1-3]: "
        read switch_choice
        
        case $switch_choice in
            1)
                echo
                echo -e "${YELLOW}Launching new shell in $target_path${NC}"
                echo -e "${CYAN}Type 'exit' to return to the menu${NC}"
                echo
                cd "$target_path" && exec $SHELL
                ;;
            2)
                echo
                echo -e "${GREEN}Run this command to switch:${NC}"
                echo -e "${CYAN}$cd_command${NC}"
                echo
                echo -n "Press Enter to continue..."
                read
                ;;
            3)
                return
                ;;
            *)
                echo -e "${RED}Invalid choice!${NC}"
                sleep 1
                ;;
        esac
    else
        echo -e "${RED}Invalid choice!${NC}"
        sleep 1
    fi
}

create_worktree() {
    clear_screen
    print_header
    echo -e "${WHITE}Create New Worktree:${NC}"
    echo
    
    echo -n "Enter branch name: "
    read branch_name
    
    if [[ -z "$branch_name" ]]; then
        echo -e "${RED}Branch name cannot be empty!${NC}"
        sleep 2
        return
    fi
    
    echo -n "Base branch (default: main): "
    read base_branch
    base_branch=${base_branch:-main}
    
    echo
    echo -e "${YELLOW}Creating worktree '$branch_name' from '$base_branch'...${NC}"
    
    if ./scripts/worktree-create.sh "$branch_name" "$base_branch"; then
        echo -e "${GREEN}Worktree created successfully!${NC}"
    else
        echo -e "${RED}Failed to create worktree${NC}"
    fi
    
    echo
    echo -n "Press Enter to continue..."
    read
}

delete_worktree() {
    clear_screen
    print_header
    echo -e "${WHITE}Delete Worktree:${NC}"
    echo
    
    local worktrees=$(git worktree list 2>/dev/null | grep -v "^$(git rev-parse --show-toplevel) ")
    if [[ -z "$worktrees" ]]; then
        echo -e "${RED}No additional worktrees found to delete${NC}"
        echo -n "Press Enter to continue..."
        read
        return
    fi
    
    echo "$worktrees"
    echo
    local count=1
    local worktree_info=()
    
    while IFS= read -r line; do
        local path=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $2}' | tr -d '[]')
        worktree_info+=("$path|$branch")
        echo -e "${GREEN}${count}.${NC} ${CYAN}${branch}${NC} - ${path}"
        ((count++))
    done <<< "$worktrees"
    
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select worktree to delete [0-$((count-1))]: "
    
    read choice
    if [[ "$choice" == "0" ]]; then
        return
    elif [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -lt "$count" ]]; then
        local info="${worktree_info[$((choice-1))]}"
        local path=$(echo "$info" | cut -d'|' -f1)
        local branch=$(echo "$info" | cut -d'|' -f2)
        
        echo
        echo -e "${RED}WARNING: This will delete worktree '$branch' at '$path'${NC}"
        echo -n "Are you sure? [y/N]: "
        read confirm
        
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Deleting worktree...${NC}"
            git worktree remove "$path" --force
            echo -e "${GREEN}Worktree deleted successfully!${NC}"
        else
            echo -e "${YELLOW}Cancelled${NC}"
        fi
    else
        echo -e "${RED}Invalid choice!${NC}"
        sleep 1
    fi
    
    echo
    echo -n "Press Enter to continue..."
    read
}

show_git_menu() {
    clear_screen
    print_header
    echo -e "${WHITE}Git Operations:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Git Status"
    echo -e "${GREEN}2.${NC} Git Pull"
    echo -e "${GREEN}3.${NC} Git Push"
    echo -e "${GREEN}4.${NC} Git Log (last 5 commits)"
    echo -e "${GREEN}5.${NC} List Branches"
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select option [0-5]: "
    
    read choice
    case $choice in
        1) clear_screen && git status && echo && echo -n "Press Enter to continue..." && read ;;
        2) clear_screen && git pull && echo && echo -n "Press Enter to continue..." && read ;;
        3) clear_screen && git push && echo && echo -n "Press Enter to continue..." && read ;;
        4) clear_screen && git log --oneline -5 && echo && echo -n "Press Enter to continue..." && read ;;
        5) clear_screen && git branch -a && echo && echo -n "Press Enter to continue..." && read ;;
        0) return ;;
        *) echo -e "${RED}Invalid choice!${NC}" && sleep 1 ;;
    esac
}

show_db_menu() {
    clear_screen
    print_header
    echo -e "${WHITE}Database Operations:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Run Migrations"
    echo -e "${GREEN}2.${NC} Seed Database"
    echo -e "${GREEN}3.${NC} Reset Database (migrate + seed)"
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select option [0-3]: "
    
    read choice
    case $choice in
        1) clear_screen && npm run db:migrate && echo && echo -n "Press Enter to continue..." && read ;;
        2) clear_screen && npm run db:seed && echo && echo -n "Press Enter to continue..." && read ;;
        3) clear_screen && npm run db:migrate && npm run db:seed && echo && echo -n "Press Enter to continue..." && read ;;
        0) return ;;
        *) echo -e "${RED}Invalid choice!${NC}" && sleep 1 ;;
    esac
}

launch_claude() {
    clear_screen
    echo -e "${YELLOW}Launching Claude Code...${NC}"
    if command -v claude >/dev/null 2>&1; then
        claude
    else
        echo -e "${RED}Claude Code not found in PATH${NC}"
        echo -n "Press Enter to continue..."
        read
    fi
}

launch_editor() {
    clear_screen
    print_header
    echo -e "${WHITE}Launch Editor:${NC}"
    echo
    echo -e "${GREEN}1.${NC} VSCode (code .)"
    echo -e "${GREEN}2.${NC} VSCode Insiders (code-insiders .)"
    echo -e "${GREEN}3.${NC} Vim"
    echo -e "${GREEN}4.${NC} Nano"
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select editor [0-4]: "
    
    read choice
    case $choice in
        1) command -v code >/dev/null 2>&1 && code . || echo -e "${RED}VSCode not found${NC}" ;;
        2) command -v code-insiders >/dev/null 2>&1 && code-insiders . || echo -e "${RED}VSCode Insiders not found${NC}" ;;
        3) vim . ;;
        4) nano . ;;
        0) return ;;
        *) echo -e "${RED}Invalid choice!${NC}" && sleep 1 ;;
    esac
}

show_project_info() {
    clear_screen
    print_header
    echo -e "${WHITE}Project Information:${NC}"
    echo
    
    if [[ -f "package.json" ]]; then
        local name=$(grep '"name"' package.json | sed 's/.*"name": *"\([^"]*\)".*/\1/')
        local version=$(grep '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
        local description=$(grep '"description"' package.json | sed 's/.*"description": *"\([^"]*\)".*/\1/')
        
        echo -e "${CYAN}Name:${NC} $name"
        echo -e "${CYAN}Version:${NC} $version"
        echo -e "${CYAN}Description:${NC} $description"
        echo
    fi
    
    echo -e "${CYAN}Current Directory:${NC} $(pwd)"
    echo -e "${CYAN}Git Branch:${NC} $(git branch --show-current 2>/dev/null || echo 'Not a git repository')"
    echo -e "${CYAN}Node Version:${NC} $(node --version 2>/dev/null || echo 'Not installed')"
    echo -e "${CYAN}NPM Version:${NC} $(npm --version 2>/dev/null || echo 'Not installed')"
    echo
    
    if [[ -f "package.json" ]]; then
        echo -e "${WHITE}Dependencies:${NC}"
        grep -A 10 '"dependencies"' package.json | grep '"' | sed 's/.*"\([^"]*\)": *"\([^"]*\)".*/  \1: \2/' || echo "  None"
        echo
    fi
    
    echo -n "Press Enter to continue..."
    read
}

pr_review() {
    clear_screen
    print_header
    echo -e "${WHITE}PR Review Setup:${NC}"
    echo
    
    echo -n "Paste GitHub PR link (e.g., https://github.com/owner/repo/pull/123): "
    read pr_link
    
    if [[ -z "$pr_link" ]]; then
        echo -e "${RED}PR link cannot be empty!${NC}"
        sleep 2
        return
    fi
    
    # Extract PR number and repo info from the link
    if [[ "$pr_link" =~ github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
        local owner="${BASH_REMATCH[1]}"
        local repo="${BASH_REMATCH[2]}"
        local pr_number="${BASH_REMATCH[3]}"
        
        echo
        echo -e "${CYAN}Repository:${NC} $owner/$repo"
        echo -e "${CYAN}PR Number:${NC} $pr_number"
        echo
        
        # Fetch PR info using gh CLI if available
        if command -v gh >/dev/null 2>&1; then
            echo -e "${YELLOW}Fetching PR information...${NC}"
            local pr_info=$(gh pr view "$pr_link" --json headRefName,baseRefName 2>/dev/null)
            
            if [[ -n "$pr_info" ]]; then
                local branch_name=$(echo "$pr_info" | jq -r '.headRefName' 2>/dev/null)
                local base_branch=$(echo "$pr_info" | jq -r '.baseRefName' 2>/dev/null)
                
                if [[ -z "$branch_name" ]] || [[ "$branch_name" == "null" ]]; then
                    echo -n "Enter branch name for PR review: "
                    read branch_name
                    branch_name="pr-review-${pr_number}-${branch_name}"
                else
                    branch_name="pr-review-${pr_number}-${branch_name}"
                fi
            else
                echo -e "${YELLOW}Could not fetch PR info. Creating review branch...${NC}"
                branch_name="pr-review-${pr_number}"
            fi
        else
            echo -e "${YELLOW}GitHub CLI not found. Creating review branch...${NC}"
            branch_name="pr-review-${pr_number}"
        fi
        
        # Create worktree for PR review
        local worktree_path=".worktrees/${branch_name}"
        
        echo
        echo -e "${YELLOW}Creating worktree for PR review...${NC}"
        
        # Check if worktree already exists
        if git worktree list | grep -q "$worktree_path"; then
            echo -e "${YELLOW}Worktree already exists. Switching to it...${NC}"
        else
            # Fetch the PR branch
            echo -e "${YELLOW}Fetching PR branch...${NC}"
            git fetch origin pull/${pr_number}/head:${branch_name} 2>/dev/null || {
                echo -e "${YELLOW}Could not fetch PR directly. Trying alternative method...${NC}"
                # Create a new worktree from main and we'll checkout the PR later
                git worktree add "$worktree_path" -b "$branch_name" main
            }
            
            # If fetch succeeded, create worktree from the fetched branch
            if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
                git worktree add "$worktree_path" "$branch_name" 2>/dev/null || {
                    # Worktree might already exist, just use it
                    echo -e "${YELLOW}Using existing branch${NC}"
                }
            fi
        fi
        
        echo
        echo -e "${GREEN}Worktree created at: $worktree_path${NC}"
        echo -e "${YELLOW}Switching to PR review worktree and starting npm...${NC}"
        echo
        
        # Change to the worktree directory and run npm start
        cd "$worktree_path"
        
        # Install dependencies if needed
        if [[ -f "package.json" ]]; then
            echo -e "${YELLOW}Installing dependencies...${NC}"
            npm install
            echo
        fi
        
        echo -e "${GREEN}Starting application...${NC}"
        echo -e "${CYAN}You are now in the PR review worktree${NC}"
        echo -e "${CYAN}Type 'exit' to return to the main menu${NC}"
        echo
        
        # Start npm and then drop into a shell
        npm start &
        local npm_pid=$!
        
        # Give npm a moment to start
        sleep 2
        
        echo
        echo -e "${GREEN}Application started (PID: $npm_pid)${NC}"
        echo -e "${CYAN}You can now review the PR. The application is running in the background.${NC}"
        echo
        
        # Start an interactive shell in the worktree
        exec $SHELL
        
    else
        echo -e "${RED}Invalid GitHub PR link format!${NC}"
        echo -e "${YELLOW}Expected format: https://github.com/owner/repo/pull/123${NC}"
        sleep 3
    fi
    
    echo
    echo -n "Press Enter to continue..."
    read
}

main_loop() {
    while true; do
        clear_screen
        show_main_menu
        read choice
        
        case $choice in
            1) show_worktree_menu ;;
            2) create_worktree ;;
            3) delete_worktree ;;
            4) show_scripts_menu ;;
            5) show_git_menu ;;
            6) show_db_menu ;;
            7) launch_claude ;;
            8) launch_editor ;;
            9) show_project_info ;;
            10) pr_review ;;
            0) echo -e "${GREEN}Goodbye!${NC}"; exit 0 ;;
            *) echo -e "${RED}Invalid choice! Please select 0-10.${NC}"; sleep 1 ;;
        esac
    done
}

# Check if we're in a project directory
if [[ ! -f "package.json" ]]; then
    echo -e "${RED}Error: package.json not found. This script should be run from a project root.${NC}"
    exit 1
fi

main_loop
