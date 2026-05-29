const fs = require('fs');
let content = fs.readFileSync('apps/web/app/dashboard/page.tsx', 'utf8');
content = content.replace('style={{ height: % }}', 'style={{ height: h + "%" }}');
fs.writeFileSync('apps/web/app/dashboard/page.tsx', content);
