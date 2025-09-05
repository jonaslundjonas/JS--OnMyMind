jsPlumb.ready(function() {
      const canvas      = document.getElementById('canvas');
      const linkPopup   = document.getElementById('linkPopup');
      const fileInput   = document.getElementById('fileInput');
      const imageInput  = document.getElementById('imageInput');
      const themeSelector = document.getElementById('themeSelector');
      const colorPicker = document.getElementById('colorPicker');
      const tagDialog      = document.getElementById('tagDialog');
      const tagInput       = document.getElementById('tagInput');
      const tagSuggestions = document.getElementById('tagSuggestions');
      const tagOkBtn       = document.getElementById('tagOkBtn');
      const tagCancelBtn   = document.getElementById('tagCancelBtn');
      const fontSizeSelect = document.getElementById('fontSizeSelect');
      let currentZoom=1, selectedNode=null, offsetCount=0, clipboardData=null;
      let selection = []; // For multiple selections

      // Prevent toolbar buttons stealing focus
      document.querySelectorAll('#toolbar button, #toolbar select')
              .forEach(b=>b.addEventListener('mousedown', e=>e.preventDefault()));

      const getVar = n=>getComputedStyle(document.body).getPropertyValue(n).trim();
      const normalizeColor = str=> {
        if(!str||str==='transparent'||str==='rgba(0, 0, 0, 0)') return null;
        if(/^#[0-9A-Fa-f]{3}$/.test(str))
          return `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`.toLowerCase();
        if(/^#[0-9A-Fa-f]{6}$/.test(str)) return str.toLowerCase();
        try {
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.fillStyle = str;
          return ctx.fillStyle;
        } catch {
          return str;
        }
      };

      const instance = jsPlumb.getInstance({
        Connector: ['Bezier',{curviness:50}],
        Endpoint: ['Blank',{}],
        PaintStyle: { stroke:getVar('--connector-color'), strokeWidth:2 },
        ConnectionOverlays: [['Arrow',{ width:10, length:10, location:1 }]],
        Container: 'canvas',
        RenderMode: 'canvas'
      });

      // Theme switcher
      const THEMES = ['light', 'dark', 'solarized-light', 'solarized-dark', 'dracula'];
      themeSelector.onchange = ()=>{
        const selectedTheme = themeSelector.value;
        // Remove all theme classes
        THEMES.forEach(t => document.body.classList.remove(t));
        // Add the selected theme class
        document.body.classList.add(selectedTheme);

        // Update jsPlumb connector colors
        setTimeout(() => {
            const c = getVar('--connector-color');
            const tc = getVar('--tag-connector-color');
            const tagConnectorPaintStyle = {
              stroke: tc,
              strokeWidth: 2,
              dashstyle: '2 2'
            };
            instance.importDefaults({ PaintStyle:{ stroke:c, strokeWidth:2 } });
            instance.getAllConnections().forEach(cn => {
                if (cn.getParameter('tag-generated')) {
                    cn.setPaintStyle(tagConnectorPaintStyle);
                } else {
                    cn.setPaintStyle({ stroke: c, strokeWidth: 2 });
                }
            });
        }, 50); // Use a short timeout to allow CSS variables to update
      };

      // Resize canvas to fit
      function updateCanvasSize(){
        let mx=0,my=0;
        document.querySelectorAll('.node').forEach(n=>{
          mx = Math.max(mx, n.offsetLeft + n.offsetWidth);
          my = Math.max(my, n.offsetTop  + n.offsetHeight);
        });
        canvas.style.width  = (mx + 200) + 'px';
        canvas.style.height = (my + 200) + 'px';
      }

      // Resizing handle logic
      function setupResizing(nodeEl, handleEl){
        let sx, sy, sw, sh;
        const isImg  = nodeEl.classList.contains('image');
        const isCirc = nodeEl.classList.contains('circle');
        const minW   = isImg?50:(isCirc?50:100);
        const minH   = isImg?50:50;

        function doDrag(e){
          e.preventDefault();
          let nw = sw + (e.clientX - sx)/currentZoom;
          let nh = sh + (e.clientY - sy)/currentZoom;
          nw = Math.max(minW, nw);
          nh = Math.max(minH, nh);
          if(isImg){
            nodeEl.style.width  = nw + 'px';
            nodeEl.style.height = nh + 'px';
          } else if(isCirc){
            const s = Math.max(nw, nh);
            nodeEl.style.width  = nodeEl.style.height = s + 'px';
          } else {
            nodeEl.style.width  = nw + 'px';
            nodeEl.style.height = nh + 'px';
          }
          instance.revalidate(nodeEl.id);
        }
        function stopDrag(){
          document.documentElement.removeEventListener('mousemove', doDrag);
          document.documentElement.removeEventListener('mouseup', stopDrag);
          document.documentElement.removeEventListener('mouseleave', stopDrag);
          instance.revalidate(nodeEl.id);
          updateCanvasSize();
        }
        handleEl.onmousedown = e=>{
          e.preventDefault(); e.stopPropagation();
          sx = e.clientX; sy = e.clientY;
          sw = nodeEl.offsetWidth; sh = nodeEl.offsetHeight;
          document.documentElement.addEventListener('mousemove', doDrag);
          document.documentElement.addEventListener('mouseup', stopDrag);
          document.documentElement.addEventListener('mouseleave', stopDrag);
        };
      }

      // Tagging
      function updateTagConnections() {
        // 1. Clear existing tag-based connections
        const connectionsToDelete = instance.getAllConnections().filter(conn => conn.getParameter('tag-generated'));
        connectionsToDelete.forEach(conn => instance.deleteConnection(conn));

        // 2. Build a map of tags to nodes
        const tagMap = new Map();
        document.querySelectorAll('.node').forEach(node => {
          const tags = (node.dataset.tags || '').split(',').map(t => t.trim()).filter(t => t);
          tags.forEach(tag => {
            if (!tagMap.has(tag)) {
              tagMap.set(tag, []);
            }
            tagMap.get(tag).push(node.id);
          });
        });

        // 3. Create new connections
        const tagConnectorPaintStyle = {
          stroke: getVar('--tag-connector-color'),
          strokeWidth: 2,
          dashstyle: '2 2'
        };

        tagMap.forEach((nodeIds, tag) => {
          if (nodeIds.length > 1) {
            nodeIds.sort(); // Ensure consistent order for connection creation
            for (let i = 0; i < nodeIds.length; i++) {
              for (let j = i + 1; j < nodeIds.length; j++) {
                // Do not create a tag connection if a manual one already exists
                const existing = instance.getConnections({ source: nodeIds[i], target: nodeIds[j] });
                const existingReverse = instance.getConnections({ source: nodeIds[j], target: nodeIds[i] });
                if (existing.length === 0 && existingReverse.length === 0) {
                    instance.connect({
                        source: nodeIds[i],
                        target: nodeIds[j],
                        paintStyle: tagConnectorPaintStyle,
                        parameters: { 'tag-generated': true, 'tag': tag },
                    });
                }
              }
            }
          }
        });
      }

      // Node factory
      function makeNode(type, data={}){
        const id = data.id || 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        const node = document.createElement('div');
        node.className = 'node ' + type;
        node.id = id;
        // position
        if(data.left!==undefined) node.style.left = data.left;
        else node.style.left = (50 + offsetCount*20) + 'px';
        if(data.top!==undefined) node.style.top = data.top;
        else node.style.top = (50 + offsetCount*20) + 'px';
        offsetCount++;
        // angle
        node.dataset.angle = data.angle || 0;
        node.style.transform = `rotate(${node.dataset.angle}deg)`;
        // tags
        if (data.tags) node.dataset.tags = data.tags;
        // size
        if(data.width)  node.style.width  = data.width;
        if(data.height) node.style.height = data.height;

        if(type === 'image'){
          const img = document.createElement('img');
          img.src = data.imageData;
          img.style.width='100%'; img.style.height='100%'; img.style.objectFit='contain';
          node.appendChild(img);
        } else {
          const text = document.createElement('div');
          text.className = 'text';
          text.contentEditable = false;
          text.innerHTML = data.text || 'Node';
          if(data.color) node.style.backgroundColor = data.color;
          if(data.textStyles){
            if(data.textStyles.bold)      text.classList.add('text-bold');
            if(data.textStyles.italic)    text.classList.add('text-italic');
            if(data.textStyles.underline) text.classList.add('text-underline');
            if(data.textStyles.textAlign) text.style.textAlign = data.textStyles.textAlign;
            if(data.textStyles.fontSize)  text.style.fontSize   = data.textStyles.fontSize;
          }
          node.appendChild(text);
          text.addEventListener('dblclick', () => {
            text.contentEditable = true;
            text.focus();
            document.execCommand('selectAll', false, null);
          });
          text.onblur = ()=>{
            text.contentEditable = false;
            updateCanvasSize();
            instance.revalidate(node.id);
          };
        }

        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        node.appendChild(handle);
        setupResizing(node, handle);
        canvas.appendChild(node);

        node.onclick = e=>{
          const a = e.target.closest('a');
          if(a){
            e.preventDefault();
            if(e.shiftKey) window.open(a.href,'_blank');
            e.stopPropagation();
            return;
          }
          if(e.target===handle){
            e.stopPropagation();
            return;
          }

          if (!e.shiftKey) {
            // Clear previous selection unless shift is pressed
            selection.forEach(n => n.classList.remove('selected'));
            selection = [];
          }

          // Toggle selection for the current node
          if (selection.includes(node)) {
            selection = selection.filter(n => n !== node);
            node.classList.remove('selected');
          } else {
            selection.push(node);
            node.classList.add('selected');
          }

          // Update the primary selected node
          selectedNode = selection[selection.length - 1] || null;
          e.stopPropagation(); // Prevent canvas click from clearing selection
        };

        instance.draggable(node, {
            filter: ".resize-handle, a",
            start: (p) => {
                // If dragging an unselected node, make it the only selection
                if (!p.el.classList.contains('selected')) {
                    selection.forEach(n => n.classList.remove('selected'));
                    selection = [p.el];
                    p.el.classList.add('selected');
                    selectedNode = p.el;
                }
                // Record initial positions for all selected nodes
                selection.forEach(n => {
                    n.dataset.dragStartX = n.offsetLeft;
                    n.dataset.dragStartY = n.offsetTop;
                });
            },
            drag: (p) => {
                const dragEl = p.el;
                // Calculate delta from the dragged element's start position
                const dx = p.pos[0] - parseFloat(dragEl.dataset.dragStartX);
                const dy = p.pos[1] - parseFloat(dragEl.dataset.dragStartY);

                selection.forEach(n => {
                    // jsPlumb handles the dragged element's position
                    if (n !== dragEl) {
                        const newX = parseFloat(n.dataset.dragStartX) + dx;
                        const newY = parseFloat(n.dataset.dragStartY) + dy;
                        n.style.left = newX + 'px';
                        n.style.top = newY + 'px';
                        instance.revalidate(n.id);
                    }
                });
            },
            stop: (p) => {
                selection.forEach(n => {
                    // The dragged element's position is already set by jsPlumb
                    // For others, the style was set during drag.
                    // Just clean up the dataset attributes.
                    delete n.dataset.dragStartX;
                    delete n.dataset.dragStartY;
                });
                updateCanvasSize();
            }
        });
        const anchors = ['Top','Right','Bottom','Left'];
        instance.makeSource(node,{
          filter: type==='image'? 'img': '.text',
          anchor: anchors,
          connectorStyle: { stroke:getVar('--connector-color'), strokeWidth:2 },
          maxConnections: -1
        });
        instance.makeTarget(node,{
          anchor: anchors,
          maxConnections: -1,
          allowLoopback: false
        });

        return node;
      }

      instance.bind('connection', ()=> updateCanvasSize());
      instance.bind('dblclick', (c,e)=>{
        if (c.getParameter('tag-generated')) {
          // Do nothing, let the user remove the tag to remove the connection
          e.preventDefault();
          return;
        }
        instance.deleteConnection(c);
        updateTagConnections();
        e.preventDefault();
      });

      // Link popup
      canvas.onmouseover = e=>{
        const a = e.target.closest('a');
        if(a && a.closest('.node')){
          linkPopup.textContent = 'Shift+Click to Go to Link';
          linkPopup.style.left = e.pageX + 10 + 'px';
          linkPopup.style.top  = e.pageY + 10 + 'px';
          linkPopup.style.display = 'block';
        }
      };
      canvas.onmouseout = e=>{
        if(e.target.closest('a')) linkPopup.style.display = 'none';
      };
      canvas.onmouseleave = ()=> linkPopup.style.display = 'none';
      canvas.onclick = e=>{
        if(e.target===canvas && selection.length > 0){
          selection.forEach(n => n.classList.remove('selected'));
          selection = [];
          selectedNode = null;
        }
      };

      // Toolbar
      document.getElementById('addRect').onclick    = ()=> makeNode('rect');
      document.getElementById('addCircle').onclick  = ()=> makeNode('circle');
      document.getElementById('addEllipse').onclick = ()=> makeNode('ellipse');

      // Import Image
      document.getElementById('importImgBtn').onclick = ()=> imageInput.click();
      imageInput.onchange = ()=>{
        const f = imageInput.files[0];
        if(!f) return;
        const r = new FileReader();
        r.onload = e=> makeNode('image',{ imageData:e.target.result });
        r.readAsDataURL(f);
        imageInput.value = '';
      };

      // Copy / Paste
      document.getElementById('copyBtn').onclick = ()=>{
        if(!selectedNode){ clipboardData=null; return; }
        const isImg = selectedNode.classList.contains('image');
        if(isImg){
          const img = selectedNode.querySelector('img');
          clipboardData = {
            shape:'image',
            imageData:img.src,
            width:selectedNode.style.width,
            height:selectedNode.style.height,
            angle:selectedNode.dataset.angle,
            tags: selectedNode.dataset.tags || ''
          };
        } else {
          const t = selectedNode.querySelector('.text');
          const def=normalizeColor(getVar('--node-bg'));
          const comp=normalizeColor(getComputedStyle(selectedNode).backgroundColor);
          clipboardData = {
            shape: selectedNode.classList.contains('circle')?'circle'
                 : selectedNode.classList.contains('ellipse')?'ellipse':'rect',
            width:selectedNode.style.width,
            height:selectedNode.style.height,
            text:  t.innerHTML,
            color: (comp&&comp!==def)?comp:null,
            textStyles:{
              bold:     t.classList.contains('text-bold'),
              italic:   t.classList.contains('text-italic'),
              underline:t.classList.contains('text-underline'),
              textAlign:t.style.textAlign,
              fontSize: t.style.fontSize
            },
            angle:selectedNode.dataset.angle,
            tags: selectedNode.dataset.tags || ''
          };
        }
      };
      document.getElementById('pasteBtn').onclick = ()=>{
        if(!clipboardData) return;
        selection.forEach(n => n.classList.remove('selected'));
        selection = [];
        selectedNode = null;
        makeNode(clipboardData.shape, clipboardData);
        updateTagConnections();
      };

      // Text formatting
      function toggleCls(c){
        if(selection.length === 0) return;
        selection.forEach(n => {
            const t = n.querySelector('.text');
            if(t) t.classList.toggle(c);
        });
        if(selectedNode) selectedNode.querySelector('.text')?.focus();
      }
      document.getElementById('boldBtn').onclick      = ()=> toggleCls('text-bold');
      document.getElementById('italicBtn').onclick    = ()=> toggleCls('text-italic');
      document.getElementById('underlineBtn').onclick = ()=> toggleCls('text-underline');
      fontSizeSelect.onchange = e => {
        if(selection.length === 0) return;
        const fontSize = e.target.value + 'px';
        selection.forEach(n => {
            const t = n.querySelector('.text');
            if (t) {
                t.style.fontSize = fontSize;
                instance.revalidate(n.id);
            }
        });
      };

      ['alignLeftBtn','alignCenterBtn','alignRightBtn'].forEach((id,i)=>{
        document.getElementById(id).onclick = ()=>{
            if(selection.length === 0) return;
            const align = ['left','center','right'][i];
            selection.forEach(n => {
                const t = n.querySelector('.text');
                if(t) t.style.textAlign = align;
            });
        };
      });
      document.getElementById('bulletBtn').onclick = ()=>{
        if(!selectedNode) return;
        const t = selectedNode.querySelector('.text');
        t.focus(); document.execCommand('insertUnorderedList');
      };
      document.getElementById('linkBtn').onclick = ()=>{
        if(!selectedNode) return;
        const t = selectedNode.querySelector('.text');
        t.focus();
        const url = prompt('URL:','https://');
        if(url){
          document.execCommand('createLink',false,url);
          t.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener';});
        }
      };

      document.getElementById('codeBtn').onclick = () => {
        if (!selectedNode) return;
        const textEl = selectedNode.querySelector('.text');
        if (document.activeElement !== textEl) return;

        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const selectedFragment = range.extractContents();

        const pre = document.createElement('pre');
        const code = document.createElement('code');

        code.appendChild(selectedFragment);
        pre.appendChild(code);

        range.insertNode(pre);
        selection.removeAllRanges();
      };

      function getAllTags() {
        const allTags = new Set();
        document.querySelectorAll('.node[data-tags]').forEach(node => {
          (node.dataset.tags || '').split(',').forEach(tag => {
            const t = tag.trim();
            if (t) allTags.add(t);
          });
        });
        return [...allTags];
      }

      tagInput.addEventListener('input', () => {
        const allTags = getAllTags();
        const value = tagInput.value;
        const tags = value.split(',');
        const currentTag = tags[tags.length - 1].trim();

        tagSuggestions.innerHTML = '';
        if (currentTag.length === 0) {
          tagSuggestions.style.display = 'none';
          return;
        }

        const suggestions = allTags.filter(tag =>
          tag.toLowerCase().startsWith(currentTag.toLowerCase()) &&
          tag.toLowerCase() !== currentTag.toLowerCase()
        );

        if (suggestions.length > 0) {
          suggestions.forEach(suggestion => {
            const li = document.createElement('li');
            li.textContent = suggestion;
            tagSuggestions.appendChild(li);
          });
          tagSuggestions.style.display = 'block';
        } else {
          tagSuggestions.style.display = 'none';
        }
      });

      tagSuggestions.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
          const clickedTag = e.target.textContent;
          const tags = tagInput.value.split(',');
          tags[tags.length - 1] = clickedTag;
          tagInput.value = tags.join(', ');
          tagSuggestions.style.display = 'none';
          tagInput.focus();
        }
      });

      tagOkBtn.addEventListener('click', () => {
        if (selectedNode) {
          selectedNode.dataset.tags = tagInput.value.trim();
          updateTagConnections();
        }
        tagDialog.style.display = 'none';
        tagSuggestions.style.display = 'none';
      });

      tagCancelBtn.addEventListener('click', () => {
        tagDialog.style.display = 'none';
        tagSuggestions.style.display = 'none';
      });

      document.getElementById('tagBtn').onclick = ()=>{
        if (!selectedNode) return;
        tagInput.value = selectedNode.dataset.tags || '';
        tagDialog.style.display = 'flex';
        tagInput.focus();
        // Trigger input event to show initial suggestions if any
        tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      };

      // Zoom / Rotate
      function applyZoom(){
        canvas.style.transform = `scale(${currentZoom})`;
        instance.setZoom(currentZoom);
        updateCanvasSize();
      }
      document.getElementById('zoomIn').onclick  = ()=>{ currentZoom*=1.1; applyZoom(); };
      document.getElementById('zoomOut').onclick = ()=>{ currentZoom/=1.1; applyZoom(); };
      function rotateSel(d){
        if(selection.length === 0) return;
        selection.forEach(n => {
            let a = parseInt(n.dataset.angle||0) + d;
            n.dataset.angle = a;
            n.style.transform = `rotate(${a}deg)`;
            instance.revalidate(n.id);
        });
      }
      document.getElementById('rotateLeft').onclick  = ()=> rotateSel(-15);
      document.getElementById('rotateRight').onclick = ()=> rotateSel(15);

      document.getElementById('disconnectBtn').onclick = () => {
        if (selection.length < 2) return;
        const selectionIds = new Set(selection.map(n => n.id));
        const connectionsToDelete = [];

        instance.getAllConnections().forEach(conn => {
            if (selectionIds.has(conn.sourceId) && selectionIds.has(conn.targetId)) {
                // Do not delete tag-generated connections, user should remove tags instead
                if (!conn.getParameter('tag-generated')) {
                    connectionsToDelete.push(conn);
                }
            }
        });

        connectionsToDelete.forEach(conn => instance.deleteConnection(conn));
      };

      // Color picker
      colorPicker.oninput = ()=>{
        if(selection.length === 0) return;
        selection.forEach(n => {
            if (!n.classList.contains('image')) {
                n.style.backgroundColor = colorPicker.value;
            }
        });
      };

      // Save
      document.getElementById('saveBtn').onclick = ()=>{
        try {
          const nodesToSave = [];
          document.querySelectorAll('.node').forEach(n=>{
            const isImg = n.classList.contains('image');
            const base = {
              id: n.id,
              left: n.style.left,
              top:  n.style.top,
              width:  n.style.width  || getComputedStyle(n).width,
              height: n.style.height || getComputedStyle(n).height,
              angle:  n.dataset.angle || 0,
              tags: n.dataset.tags || ''
            };
            if(isImg){
              base.type = 'image';
              base.imageData = n.querySelector('img').src;
            } else {
              const t = n.querySelector('.text');
              const def= normalizeColor(getVar('--node-bg'));
              const comp= normalizeColor(getComputedStyle(n).backgroundColor);
              base.type = n.classList.contains('circle')?'circle'
                        : n.classList.contains('ellipse')?'ellipse':'rect';
              base.text = t.innerHTML;
              base.color= (comp&&comp!==def)?comp:null;
              base.textStyles = {
                bold:      t.classList.contains('text-bold'),
                italic:    t.classList.contains('text-italic'),
                underline: t.classList.contains('text-underline'),
                textAlign: t.style.textAlign,
                fontSize:  t.style.fontSize
              };
            }
            nodesToSave.push(base);
          });
          const conns = instance.getAllConnections().map(c=>({
            source: c.source.id,
            target: c.target.id
          }));
          const data = { nodes: nodesToSave, connections: conns };
          const json = JSON.stringify(data,null,2);
          const blob = new Blob([json],{type:'application/json'});
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url; a.download = 'onmymind.omm';
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch(e) {
          alert('Error saving: '+e.message);
        }
      };

      // Load
      document.getElementById('loadBtn').onclick = ()=> fileInput.click();
      fileInput.onchange = ()=>{
        const f = fileInput.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = e=>{
          try {
            const obj = JSON.parse(e.target.result);
            instance.deleteEveryConnection();
            document.querySelectorAll('.node').forEach(n=>n.remove());
            offsetCount=0;
            obj.nodes.forEach(nd=> makeNode(nd.type||nd.type, nd));
            setTimeout(()=>{
              obj.connections.forEach(cn=>
                instance.connect({ source:cn.source, target:cn.target, type:'basic' })
              );
              updateCanvasSize();
              updateTagConnections();
            },50);
          } catch(er) {
            alert('Error loading: '+er.message);
          }
        };
        r.readAsText(f);
        fileInput.value = '';
      };

      // Export PNG
      document.getElementById('exportPngBtn').onclick = ()=>{
        try {
          instance.repaintEverything();
          canvas.querySelectorAll('canvas.jtk-connector').forEach(cc=>{
            cc.width  = canvas.scrollWidth;
            cc.height = canvas.scrollHeight;
            cc.style.width  = canvas.scrollWidth + 'px';
            cc.style.height = canvas.scrollHeight + 'px';
          });
          const currentSelection = [...selection];
          if(selection.length > 0) selection.forEach(n=>n.classList.remove('selected'));
          const ox=window.scrollX, oy=window.scrollY;
          window.scrollTo(0,0);
          setTimeout(()=>{
            html2canvas(canvas,{
              scale:1,
              width:canvas.scrollWidth,
              height:canvas.scrollHeight,
              windowWidth:canvas.scrollWidth,
              windowHeight:canvas.scrollHeight,
              scrollX:0, scrollY:0,
              useCORS:true,
              allowTaint:true,
              foreignObjectRendering:true,
              backgroundColor:getVar('--canvas-bg')
            }).then(cEl=>{
              cEl.toBlob(blob=>{
                const a=document.createElement('a');
                a.href=URL.createObjectURL(blob);
                a.download='onmymind.png';
                document.body.appendChild(a); a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                if(currentSelection.length > 0) currentSelection.forEach(n=>n.classList.add('selected'));
                window.scrollTo(ox,oy);
              });
            }).catch(err=>{
              alert('Error exporting PNG: '+err.message);
              if(currentSelection.length > 0) currentSelection.forEach(n=>n.classList.add('selected'));
              window.scrollTo(ox,oy);
            });
          },200);
        } catch(e) {
          alert('Error exporting PNG: '+e.message);
        }
      };

      // Export PDF
      document.getElementById('exportPdfBtn').onclick = ()=>{
        try {
          instance.repaintEverything();
          canvas.querySelectorAll('canvas.jtk-connector').forEach(cc=>{
            cc.width  = canvas.scrollWidth;
            cc.height = canvas.scrollHeight;
            cc.style.width  = canvas.scrollWidth + 'px';
            cc.style.height = canvas.scrollHeight + 'px';
          });
          const currentSelection = [...selection];
          if(selection.length > 0) selection.forEach(n=>n.classList.remove('selected'));
          const ox=window.scrollX, oy=window.scrollY;
          window.scrollTo(0,0);
          setTimeout(()=>{
            html2canvas(canvas,{
              scale:1,
              width:canvas.scrollWidth,
              height:canvas.scrollHeight,
              windowWidth:canvas.scrollWidth,
              windowHeight:canvas.scrollHeight,
              scrollX:0,scrollY:0,
              useCORS:true,
              allowTaint:true,
              foreignObjectRendering:true,
              backgroundColor:getVar('--canvas-bg')
            }).then(cEl=>{
              const imgData=cEl.toDataURL('image/png');
              const { jsPDF } = window.jspdf;
              const orient= canvas.scrollWidth>canvas.scrollHeight?'l':'p';
              const pdf=new jsPDF({orientation:orient,unit:'pt',format:[canvas.scrollWidth,canvas.scrollHeight]});
              pdf.addImage(imgData,'PNG',0,0,canvas.scrollWidth,canvas.scrollHeight);
              pdf.save('onmymind.pdf');
              if(currentSelection.length > 0) currentSelection.forEach(n=>n.classList.add('selected'));
              window.scrollTo(ox,oy);
            }).catch(err=>{
              alert('Error exporting PDF: '+err.message);
              if(currentSelection.length > 0) currentSelection.forEach(n=>n.classList.add('selected'));
              window.scrollTo(ox,oy);
            });
          },200);
        } catch(e) {
          alert('Error exporting PDF: '+e.message);
        }
      };

      // Delete with Backspace/Delete
      document.addEventListener('keydown',e=>{
        if((e.key==='Delete'||e.key==='Backspace') && selection.length > 0){
            selection.forEach(n => instance.remove(n));
            selection = [];
            selectedNode = null;
            updateCanvasSize();
            updateTagConnections();
            e.preventDefault();
        }
      });

      // Initial layout
      updateCanvasSize();
    });
