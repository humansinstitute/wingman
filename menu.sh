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
    echo -e "${BLUE}║${WHITE}                    WINGMAN CLI MENU SYSTEM                    ${BLUE}║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo
    
    # Show current context
    local current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    local current_dir=$(basename "$PWD")
    echo -e "${CYAN}Project:${NC} ${current_dir}  ${CYAN}Branch:${NC} ${current_branch}"
    
    # Check if we're in a worktree
    local worktree_info=$(git worktree list --porcelain 2>/dev/null | grep "$(pwd)" | head -1 || echo "")
    if [[ -n "$worktree_info" ]]; then
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
    
    # Conditionally show database operations if database setup exists
    if [ -f "scripts/migrate.js" ] || [ -f "db/database.sqlite" ]; then
        echo -e "${GREEN}6.${NC} Database Operations"
        echo -e "${GREEN}7.${NC} Launch Claude Code"
        echo -e "${GREEN}8.${NC} Launch Editor"
        echo -e "${GREEN}9.${NC} Project Info"
    else
        echo -e "${GREEN}6.${NC} Launch Claude Code"
        echo -e "${GREEN}7.${NC} Launch Editor"
        echo -e "${GREEN}8.${NC} Project Info"
    fi
    
    echo
    echo -e "${RED}0.${NC} Exit"
    echo
    echo -n "Select option: "
}

show_scripts_menu() {
    clear_screen
    print_header
    echo -e "${WHITE}Available Scripts:${NC}"
    echo
    
    local scripts=""
    if [ -f "package.json" ]; then
        # Parse package.json scripts - try jq first, fallback to grep/sed
        if command -v jq >/dev/null 2>&1; then
            scripts=$(jq -r '.scripts | to_entries[] | "\(.key)|\(.value)"' package.json 2>/dev/null)
        else
            # Fallback parsing without jq
            scripts=$(grep -A 20 '"scripts"' package.json | sed -n '/".*":/p' | sed 's/.*"\([^"]*\)": *"\([^"]*\)".*/\1|\2/' | head -20)
        fi
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

# Include other menu functions (simplified for enhancement mode)
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
        cd "$target_path" && exec bash
    else
        echo -e "${RED}Invalid choice!${NC}"
        sleep 1
    fi
}

# Simplified menu functions for enhancement mode
show_git_menu() {
    clear_screen
    print_header
    echo -e "${WHITE}Git Operations:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Git Status"
    echo -e "${GREEN}2.${NC} Git Log (last 5 commits)"
    echo -e "${GREEN}3.${NC} List Branches"
    echo
    echo -e "${RED}0.${NC} Back to Main Menu"
    echo
    echo -n "Select option [0-3]: "
    
    read choice
    case $choice in
        1) clear_screen && git status && echo && echo -n "Press Enter to continue..." && read ;;
        2) clear_screen && git log --oneline -5 && echo && echo -n "Press Enter to continue..." && read ;;
        3) clear_screen && git branch -a && echo && echo -n "Press Enter to continue..." && read ;;
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

main_loop() {
    while true; do
        clear_screen
        show_main_menu
        read choice
        
        # Check if database operations are available
        local has_db_ops=false
        if [ -f "scripts/migrate.js" ] || [ -f "db/database.sqlite" ]; then
            has_db_ops=true
        fi
        
        if [ "$has_db_ops" = true ]; then
            case $choice in
                1) show_worktree_menu ;;
                2) ./scripts/worktree-create.sh ;;
                3) echo "Worktree deletion not implemented in simplified menu" ;;
                4) show_scripts_menu ;;
                5) show_git_menu ;;
                6) echo "Database operations not implemented in simplified menu" ;;
                7) launch_claude ;;
                8) code . 2>/dev/null || echo "Editor not available" ;;
                9) echo "Project info display not implemented in simplified menu" ;;
                0) echo -e "${GREEN}Goodbye!${NC}"; exit 0 ;;
                *) echo -e "${RED}Invalid choice!${NC}"; sleep 1 ;;
            esac
        else
            case $choice in
                1) show_worktree_menu ;;
                2) ./scripts/worktree-create.sh ;;
                3) echo "Worktree deletion not implemented in simplified menu" ;;
                4) show_scripts_menu ;;
                5) show_git_menu ;;
                6) launch_claude ;;
                7) code . 2>/dev/null || echo "Editor not available" ;;
                8) echo "Project info display not implemented in simplified menu" ;;
                0) echo -e "${GREEN}Goodbye!${NC}"; exit 0 ;;
                *) echo -e "${RED}Invalid choice!${NC}"; sleep 1 ;;
            esac
        fi
    done
}

# Check if we're in a project directory
if [[ ! -f "package.json" ]] && [[ ! -d ".git" ]]; then
    echo -e "${RED}Warning: This doesn't appear to be a project root directory.${NC}"
    echo "The menu system works best when run from a project root."
    echo
fi

main_loop
