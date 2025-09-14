#!/usr/bin/env python3
"""
Markdown Index Generator
Automatically creates index.json for the Markdown Files Viewer
"""

import os
import json
import argparse
from pathlib import Path
import sys

def scan_markdown_directory(directory_path):
    """
    Scan the markdown directory and return all .md files
    
    Args:
        directory_path (str): Path to the markdown directory
        
    Returns:
        list: List of markdown filenames
    """
    md_files = []
    
    if not os.path.exists(directory_path):
        print(f"❌ Directory '{directory_path}' does not exist!")
        return md_files
    
    try:
        for file in os.listdir(directory_path):
            if file.lower().endswith('.md'):
                md_files.append(file)
                
        # Sort files alphabetically
        md_files.sort()
        
    except Exception as e:
        print(f"❌ Error scanning directory: {e}")
        return []
    
    return md_files

def get_file_info(file_path):
    """
    Get additional information about a markdown file
    
    Args:
        file_path (str): Path to the markdown file
        
    Returns:
        dict: File information including size and modification time
    """
    try:
        stat = os.stat(file_path)
        return {
            'size': stat.st_size,
            'modified': stat.st_mtime,
            'exists': True
        }
    except Exception:
        return {
            'size': 0,
            'modified': 0,
            'exists': False
        }

def create_index_json(md_files, output_path, include_metadata=False):
    """
    Create the index.json file
    
    Args:
        md_files (list): List of markdown filenames
        output_path (str): Path where to save index.json
        include_metadata (bool): Whether to include file metadata
    """
    
    if include_metadata:
        # Create detailed index with metadata
        index_data = {
            "files": [],
            "generated_at": os.path.getctime(output_path) if os.path.exists(output_path) else None,
            "total_files": len(md_files)
        }
        
        for file in md_files:
            file_path = os.path.join(os.path.dirname(output_path), file)
            info = get_file_info(file_path)
            
            index_data["files"].append({
                "name": file,
                "size": info['size'],
                "exists": info['exists']
            })
    else:
        # Create simple index (just array of filenames)
        index_data = md_files
    
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"❌ Error writing index.json: {e}")
        return False

def create_files_txt(md_files, output_path):
    """
    Create a simple files.txt as alternative to index.json
    
    Args:
        md_files (list): List of markdown filenames
        output_path (str): Path where to save files.txt
    """
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            for file in md_files:
                f.write(f"{file}\n")
        return True
    except Exception as e:
        print(f"❌ Error writing files.txt: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description="Generate index.json for Markdown Files Viewer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate_index.py                    # Use default ./markdown directory
  python generate_index.py -d ./docs         # Use custom directory
  python generate_index.py -m                # Include metadata in index
  python generate_index.py -t                # Also create files.txt
  python generate_index.py -v                # Verbose output
        """
    )
    
    parser.add_argument(
        '-d', '--directory', 
        default='./markdown',
        help='Directory containing markdown files (default: ./markdown)'
    )
    
    parser.add_argument(
        '-o', '--output',
        help='Output path for index.json (default: <directory>/index.json)'
    )
    
    parser.add_argument(
        '-m', '--metadata',
        action='store_true',
        help='Include file metadata in index.json'
    )
    
    parser.add_argument(
        '-t', '--text-file',
        action='store_true',
        help='Also create files.txt alongside index.json'
    )
    
    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Verbose output'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without creating files'
    )

    args = parser.parse_args()
    
    # Resolve paths
    markdown_dir = os.path.abspath(args.directory)
    output_path = args.output or os.path.join(markdown_dir, 'index.json')
    output_path = os.path.abspath(output_path)
    
    if args.verbose:
        print(f"📁 Scanning directory: {markdown_dir}")
        print(f"📄 Output path: {output_path}")
        print()
    
    # Scan for markdown files
    md_files = scan_markdown_directory(markdown_dir)
    
    if not md_files:
        print("❌ No markdown files found!")
        print(f"   Make sure .md files exist in: {markdown_dir}")
        sys.exit(1)
    
    # Display found files
    print(f"✅ Found {len(md_files)} markdown files:")
    for i, file in enumerate(md_files, 1):
        file_path = os.path.join(markdown_dir, file)
        info = get_file_info(file_path)
        size_kb = info['size'] / 1024 if info['size'] > 0 else 0
        
        if args.verbose:
            print(f"   {i:2d}. {file} ({size_kb:.1f} KB)")
        else:
            print(f"   {i:2d}. {file}")
    
    print()
    
    if args.dry_run:
        print("🔍 DRY RUN - No files will be created")
        print(f"Would create: {output_path}")
        if args.text_file:
            txt_path = output_path.replace('.json', '.txt').replace('index.txt', 'files.txt')
            print(f"Would create: {txt_path}")
        return
    
    # Create index.json
    success = create_index_json(md_files, output_path, args.metadata)
    
    if success:
        print(f"✅ Created index.json: {output_path}")
        
        # Also create files.txt if requested
        if args.text_file:
            txt_path = output_path.replace('.json', '.txt').replace('index.txt', 'files.txt')
            if create_files_txt(md_files, txt_path):
                print(f"✅ Created files.txt: {txt_path}")
            else:
                print(f"❌ Failed to create files.txt")
    else:
        print("❌ Failed to create index.json")
        sys.exit(1)
    
    print()
    print("🚀 Ready for deployment!")
    print(f"   Upload your project folder to Cloudflare Pages")
    print(f"   Your markdown viewer will automatically load all {len(md_files)} files")

if __name__ == "__main__":
    main()
