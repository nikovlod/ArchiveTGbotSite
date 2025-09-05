const fs = require('fs');
const path = require('path');

const markdownDir = path.join(__dirname, 'markdown');
const outputFilePath = path.join(__dirname, 'data.json');

// This function is copied from your index.html and adapted for Node.js
function parseMarkdownContent(content) {
    const lines = content.split('\n');
    const categories = [];
    let currentCategory = null;
    let links = [];

    for (const line of lines) {
        const trimmed = line.trim();
        const headingMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
        if (headingMatch) {
            if (currentCategory) categories.push(currentCategory);
            currentCategory = { title: headingMatch[1], links: [] };
            continue;
        }

        const linkMatch = trimmed.match(/^(\d+\.\s*)?\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
            const link = {
                title: linkMatch[2],
                url: linkMatch[3],
                category: currentCategory ? currentCategory.title : 'Uncategorized'
            };
            if (currentCategory) currentCategory.links.push(link);
            links.push(link);
        }
    }
    if (currentCategory) categories.push(currentCategory);
    if (categories.length === 0 && links.length > 0) {
        categories.push({ title: 'All Links', links: links });
    }
    return { categories, links };
}

// Main script logic
try {
    const indexFile = fs.readFileSync(path.join(markdownDir, 'index.json'), 'utf-8');
    const fileList = JSON.parse(indexFile);

    const allData = fileList.map(fileName => {
        const filePath = path.join(markdownDir, fileName);
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsedContent = parseMarkdownContent(content);

        return {
            name: fileName,
            path: `./markdown/${fileName}`,
            content: parsedContent,
            linkCount: parsedContent.links.length
        };
    });

    fs.writeFileSync(outputFilePath, JSON.stringify(allData, null, 2));
    console.log(`✅ Successfully compiled ${allData.length} files into ${outputFilePath}`);

} catch (error) {
    console.error('❌ Error building data file:', error.message);
    console.error('Make sure "markdown/index.json" exists and is correctly formatted.');
}
