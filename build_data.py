#!/usr/bin/env python3
"""
Markdown Data Generator for the Archived Videos Index
Scans a directory for markdown files, parses their content into a structured
format with categories and optional subcategories, and outputs a single data.json file.
"""
import os
import json
import re
import argparse
from pathlib import Path

def sanitize_string_for_json(input_str):
    """
    Cleans a string to be safely included in JSON.
    - Escapes backslashes and double quotes.
    - Replaces newline and tab characters with spaces.
    - Removes ASCII control characters.
    - Strips leading/trailing whitespace.
    """
    if not isinstance(input_str, str):
        return ""
    # 1. Escape backslashes and double quotes (most important for JSON structure)
    s = input_str.replace('\\', '\\\\').replace('"', '\\"')
    # 2. Replace newlines, tabs, and carriage returns with a single space
    s = re.sub(r'[\n\r\t]+', ' ', s)
    # 3. Remove other non-printable ASCII control characters
    s = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', s)
    return s.strip()

def parse_markdown_content(content):
    """
    Parses the text content of a markdown file into a structured dictionary.
    
    Args:
        content (str): The markdown file content.
        
    Returns:
        dict: A dictionary containing parsed categories, subcategories, and links.
    """
    lines = content.splitlines()
    data = {
        "categories": [], 
        "uncategorizedLinks": [],
        "links": []
    }
    current_category = None
    current_subcategory = None
    has_seen_category = False

    for line in lines:
        trimmed = line.strip()
        
        category_match = re.match(r'^\*\*(.+?)\*\*$', trimmed)
        if category_match:
            has_seen_category = True
            category_title = sanitize_string_for_json(category_match.group(1))
            current_category = {
                "title": category_title,
                "links": [],
                "subcategories": []
            }
            data["categories"].append(current_category)
            current_subcategory = None
            continue

        subcategory_match = re.match(r'^\*(.+?)\*$', trimmed)
        if subcategory_match and current_category:
            subcategory_title = sanitize_string_for_json(subcategory_match.group(1))
            current_subcategory = {
                "title": subcategory_title,
                "links": []
            }
            current_category["subcategories"].append(current_subcategory)
            continue

        link_match = re.match(r'^(?:\d+\.\s*)?\[(.*?)\]\((.*?)\)', trimmed)
        if link_match:
            link_title = sanitize_string_for_json(link_match.group(1))
            link_url = sanitize_string_for_json(link_match.group(2))
            
            if not link_title or not link_url:
                continue

            link_data = {"title": link_title, "url": link_url}

            if current_category:
                if current_subcategory:
                    current_subcategory["links"].append(link_data)
                    data["links"].append({**link_data, "category": current_category["title"], "subcategory": current_subcategory["title"]})
                else:
                    current_category["links"].append(link_data)
                    data["links"].append({**link_data, "category": current_category["title"], "subcategory": None})
            elif not has_seen_category:
                data["uncategorizedLinks"].append(link_data)
                data["links"].append({**link_data, "category": "Uncategorized", "subcategory": None})
                
    return data

def main():
    """Main function to run the script."""
    # This function is currently not being called, the logic is in the __main__ block.
    # It's kept here for reference but could be removed or refactored.
    parser = argparse.ArgumentParser(
        description="Generate data.json for the Markdown Viewer from a directory of .md files.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument('-d', '--directory', default='./markdown', help='Directory containing markdown files (default: ./markdown)')
    parser.add_argument('-o', '--output', default='./data.json', help='Output path for the final data.json file (default: ./data.json)')
    args = parser.parse_args()

    markdown_dir = Path(args.directory)
    output_file = Path(args.output)

    if not markdown_dir.is_dir():
        print(f"❌ Error: Directory not found at '{markdown_dir}'")
        return

    print(f"📁 Scanning directory: {markdown_dir.resolve()}")
    all_file_data = []
    md_files = sorted(markdown_dir.glob('*.md'))

    if not md_files:
        print("❌ No markdown files found in the directory.")
        return
        
    print(f"✅ Found {len(md_files)} markdown files. Processing...")

    for file_path in md_files:
        print(f"   -> Processing '{file_path.name}'")
        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            
            parsed_content = parse_markdown_content(content)
            
            file_data = {
                "name": file_path.name,
                "path": f"./markdown/{file_path.name}",
                "content": parsed_content,
                "linkCount": len(parsed_content["links"])
            }
            all_file_data.append(file_data)
        except Exception as e:
            print(f"      ❌ Error processing file {file_path.name}: {e}")

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(all_file_data, f, indent=2, ensure_ascii=False)
        print(f"\n🚀 Successfully compiled data for {len(all_file_data)} files into '{output_file.resolve()}'")

    except Exception as e:
        print(f"\n❌ Error writing final JSON file: {e}")

if __name__ == "__main__":
    # Correcting the main execution logic to use the most robust sanitizer
    # The logic inside main() got a bit tangled. Let's clean it up.
    
    # Re-defining the sanitize function here to ensure it's the correct one.
    def sanitize_string_for_json_final(input_str):
        if not isinstance(input_str, str): return ""
        s = re.sub(r'[\n\r\t]+', ' ', input_str)
        s = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', s)
        return s.strip()

    # Re-defining the parse function to use the final sanitizer.
    def parse_markdown_content_final(content):
        lines = content.splitlines()
        data = { "categories": [], "uncategorizedLinks": [], "links": [] }
        current_category, current_subcategory, has_seen_category = None, None, False
        for line in lines:
            trimmed = line.strip()
            category_match = re.match(r'^\*\*(.+?)\*\*$', trimmed)
            if category_match:
                has_seen_category = True
                category_title = sanitize_string_for_json_final(category_match.group(1))
                current_category = {"title": category_title, "links": [], "subcategories": []}
                data["categories"].append(current_category)
                current_subcategory = None
                continue
            subcategory_match = re.match(r'^\*(.+?)\*$', trimmed)
            if subcategory_match and current_category:
                subcategory_title = sanitize_string_for_json_final(subcategory_match.group(1))
                current_subcategory = {"title": subcategory_title, "links": []}
                current_category["subcategories"].append(current_subcategory)
                continue
            link_match = re.match(r'^(?:\d+\.\s*)?\[(.*?)\]\((.*?)\)', trimmed)
            if link_match:
                link_title = sanitize_string_for_json_final(link_match.group(1))
                link_url = sanitize_string_for_json_final(link_match.group(2))
                if not link_title or not link_url: continue
                link_data = {"title": link_title, "url": link_url}
                if current_category:
                    if current_subcategory:
                        current_subcategory["links"].append(link_data)
                        data["links"].append({**link_data, "category": current_category["title"], "subcategory": current_subcategory["title"]})
                    else:
                        current_category["links"].append(link_data)
                        data["links"].append({**link_data, "category": current_category["title"], "subcategory": None})
                elif not has_seen_category:
                    data["uncategorizedLinks"].append(link_data)
                    data["links"].append({**link_data, "category": "Uncategorized", "subcategory": None})
        return data

    # Cleaned up main execution logic
    
    # FIX: Define the ArgumentParser here, in the correct scope.
    parser = argparse.ArgumentParser(
        description="Generate data.json for the Markdown Viewer from a directory of .md files.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument('-d', '--directory', default='./markdown', help='Directory containing markdown files (default: ./markdown)')
    parser.add_argument('-o', '--output', default='./data.json', help='Output path for the final data.json file (default: ./data.json)')

    args = parser.parse_args()
    markdown_dir = Path(args.directory)
    output_file = Path(args.output)
    if not markdown_dir.is_dir():
        print(f"❌ Error: Directory not found at '{markdown_dir}'")
    else:
        print(f"📁 Scanning directory: {markdown_dir.resolve()}")
        all_file_data = []
        md_files = sorted(markdown_dir.glob('*.md'))
        if not md_files:
            print("❌ No markdown files found in the directory.")
        else:
            print(f"✅ Found {len(md_files)} markdown files. Processing...")
            for file_path in md_files:
                print(f"   -> Processing '{file_path.name}'")
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                    parsed_content = parse_markdown_content_final(content)
                    file_data = {
                        "name": file_path.name,
                        "path": f"./markdown/{file_path.name}",
                        "content": parsed_content,
                        "linkCount": len(parsed_content["links"])
                    }
                    all_file_data.append(file_data)
                except Exception as e:
                    print(f"      ❌ Error processing file {file_path.name}: {e}")
            try:
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(all_file_data, f, indent=2, ensure_ascii=False)
                print(f"\n🚀 Successfully compiled data for {len(all_file_data)} files into '{output_file.resolve()}'")
            except Exception as e:
                print(f"\n❌ Error writing final JSON file: {e}")

