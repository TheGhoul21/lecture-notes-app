const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');



// Reads from the `CLOUD_ML_REGION` & `ANTHROPIC_VERTEX_PROJECT_ID` environment variables.
// Additionally goes through the standard `google-auth-library` flow.
const client = new AnthropicVertex();

// Replace placeholders like {{section}} with real values,
// because the SDK does not support variables.
const msg = await client.messages.create({
  model: "claude-3-5-sonnet-v2@20241022",
  max_tokens: 4096,
  temperature: 0,
  messages: [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "<examples>\n<example>\n<section>\n\\section{Introduction to Derivatives}\nA derivative represents the rate of change of a function with respect to a variable. It is defined as:\n\\[\nf'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}\n\\]\nThe derivative can be interpreted as the slope of the tangent line to the graph of a function at a given point.\n</section>\n<transcript>\nOkay, let's start a new section. Backslash section… uh… curly brackets… \"Introduction to Derivatives\". Right. So, a derivative… what is it? Well, it represents the rate of change… of a function… with respect to a variable. That's the key idea, right? Backslash begin… equation… Okay, we want f prime of x. So, f… apostrophe… open parentheses x… equals… limit. So, backslash lim… underscore… curly brackets… h… backslash to… zero. Right, h goes to zero. Backslash frac… open curly brackets… and in the numerator we have f of x plus h. So, f… open parentheses… x plus h… close parentheses. Then minus… f of x. So, minus… f… open parentheses x… close parentheses. And in the denominator… just h. So, close curly brackets… h. Right, that looks good. Backslash end… equation. There we go. That’s the definition, nice and clean. Now, let's add a bit of explanation. So, the derivative… can be interpreted… as the slope… of the tangent line… to the graph of a function… at a given point. Yeah, that's a good way to put it. Right, I think that’s a pretty good intro. Let's compile this and see how it looks. Perfect! That's exactly what I wanted.\n</transcript>\n<ideal_output>\n<video_planning>\n1. Main mathematical concepts:\n   - Derivative\n   - Rate of change\n   - Limit\n   - Slope of tangent line\n\n2. Potential visual representations:\n   - Graph of a function with a tangent line\n   - Animated secant line approaching tangent line\n   - Zooming in on a curve to show local linearity\n   - Visual representation of the limit definition\n\n3. Rough structure (scenes):\n   1. Introduction to the concept of derivatives\n   2. Visualizing rate of change\n   3. Limit definition of derivatives\n   4. Geometric interpretation as slope of tangent line\n\n4. Key visual elements and animations:\n   Scene 1:\n   - Animated title \"Introduction to Derivatives\"\n   - Fade in key points about derivatives\n\n   Scene 2:\n   - Graph of a function\n   - Animated secant lines with varying intervals\n   - Highlight changing slopes\n\n   Scene 3:\n   - Display limit definition formula\n   - Animate each part of the formula\n   - Visually represent h approaching 0\n\n   Scene 4:\n   - Graph with tangent line\n   - Zoom in to show local linearity\n   - Highlight connection between slope and derivative\n\n</video_planning>\n\n<video_outline>\nScene 1: Introduction to Derivatives\n- Fade in title \"Introduction to Derivatives\"\n- Display key points about derivatives:\n  1. Rate of change of a function\n  2. Fundamental concept in calculus\n- Transition to a simple graph (e.g., y = x^2) to set the stage\n\nScene 2: Visualizing Rate of Change\n- Start with the graph from Scene 1\n- Introduce the concept of average rate of change:\n  - Animate secant lines between two points\n  - Show how slope changes as the interval shrinks\n- Emphasize that we're approaching the instantaneous rate of change\n\nScene 3: Limit Definition of Derivatives\n- Fade in the limit definition formula\n- Break down each part of the formula with animations:\n  1. f(x+h) and f(x): Highlight these points on the graph\n  2. [f(x+h) - f(x)]: Animate the vertical distance\n  3. h: Animate the horizontal distance\n  4. [f(x+h) - f(x)] / h: Show this as the slope of the secant line\n- Animate h approaching 0, showing the secant line converging to the tangent line\n\nScene 4: Geometric Interpretation\n- Return to the graph with the tangent line\n- Zoom in on the point of tangency to show local linearity\n- Highlight that the slope of this tangent line is the derivative\n- Show f'(x) notation and its connection to the slope\n\nTransition: Fade out to conclusion\n</video_outline>\n\n<manim_code>\n# Scene 1: Introduction to Derivatives\nclass IntroductionScene(Scene):\n    def construct(self):\n        title = Text(\"Introduction to Derivatives\", font_size=48)\n        self.play(Write(title))\n        self.wait()\n        self.play(title.animate.to_edge(UP))\n\n        key_points = VGroup(\n            Text(\"• Rate of change of a function\"),\n            Text(\"• Fundamental concept in calculus\")\n        ).arrange(DOWN, aligned_edge=LEFT).next_to(title, DOWN, buff=0.5)\n\n        for point in key_points:\n            self.play(FadeIn(point))\n            self.wait(0.5)\n\n        axes = Axes(x_range=[-3, 3], y_range=[0, 9], axis_config={\"include_tip\": False})\n        graph = axes.plot(lambda x: x**2, color=BLUE)\n        graph_group = VGroup(axes, graph)\n        self.play(FadeOut(key_points), FadeIn(graph_group))\n        self.wait()\n\n# Scene 2: Visualizing Rate of Change\nclass RateOfChangeScene(Scene):\n    def construct(self):\n        axes = Axes(x_range=[-3, 3], y_range=[0, 9], axis_config={\"include_tip\": False})\n        graph = axes.plot(lambda x: x**2, color=BLUE)\n        graph_group = VGroup(axes, graph)\n        self.add(graph_group)\n\n        def get_secant_line(x1, x2):\n            line = Line(axes.c2p(x1, x1**2), axes.c2p(x2, x2**2), color=RED)\n            return line\n\n        x1, x2 = -2, 2\n        secant_line = get_secant_line(x1, x2)\n        self.play(Create(secant_line))\n        self.wait()\n\n        for _ in range(5):\n            new_x2 = (x1 + x2) / 2\n            new_secant = get_secant_line(x1, new_x2)\n            self.play(Transform(secant_line, new_secant))\n            x2 = new_x2\n            self.wait(0.5)\n\n# Scene 3: Limit Definition of Derivatives\nclass LimitDefinitionScene(Scene):\n    def construct(self):\n        limit_def = MathTex(r\"f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}\")\n        self.play(Write(limit_def))\n        self.wait()\n\n        axes = Axes(x_range=[-3, 3], y_range=[0, 9], axis_config={\"include_tip\": False})\n        graph = axes.plot(lambda x: x**2, color=BLUE)\n        graph_group = VGroup(axes, graph)\n        self.play(limit_def.animate.to_edge(UP), FadeIn(graph_group))\n\n        x = 1\n        dx = 0.5\n        px = Dot(axes.c2p(x, x**2), color=YELLOW)\n        px_label = MathTex(\"f(x)\").next_to(px, LEFT)\n        pxh = Dot(axes.c2p(x+dx, (x+dx)**2), color=GREEN)\n        pxh_label = MathTex(\"f(x+h)\").next_to(pxh, RIGHT)\n\n        secant_line = Line(px.get_center(), pxh.get_center(), color=RED)\n        slope_triangle = Polygon(px.get_center(), pxh.get_center(),\n                                 [pxh.get_center()[0], px.get_center()[1], 0],\n                                 stroke_width=0, fill_color=YELLOW, fill_opacity=0.3)\n\n        self.play(FadeIn(px), FadeIn(px_label), FadeIn(pxh), FadeIn(pxh_label))\n        self.play(Create(secant_line), FadeIn(slope_triangle))\n        self.wait()\n\n        for _ in range(5):\n            new_dx = dx / 2\n            new_pxh = Dot(axes.c2p(x+new_dx, (x+new_dx)**2), color=GREEN)\n            new_secant_line = Line(px.get_center(), new_pxh.get_center(), color=RED)\n            new_slope_triangle = Polygon(px.get_center(), new_pxh.get_center(),\n                                         [new_pxh.get_center()[0], px.get_center()[1], 0],\n                                         stroke_width=0, fill_color=YELLOW, fill_opacity=0.3)\n            self.play(\n                Transform(pxh, new_pxh),\n                pxh_label.animate.next_to(new_pxh, RIGHT),\n                Transform(secant_line, new_secant_line),\n                Transform(slope_triangle, new_slope_triangle)\n            )\n            dx = new_dx\n            self.wait(0.5)\n\n# Scene 4: Geometric Interpretation\nclass GeometricInterpretationScene(Scene):\n    def construct(self):\n        axes = Axes(x_range=[-3, 3], y_range=[0, 9], axis_config={\"include_tip\": False})\n        graph = axes.plot(lambda x: x**2, color=BLUE)\n        graph_group = VGroup(axes, graph)\n        self.add(graph_group)\n\n        x = 1\n        px = Dot(axes.c2p(x, x**2), color=YELLOW)\n        tangent_line = axes.get_secant_slope_group(\n            x, graph, dx=0.01, secant_line_color=RED,\n            secant_line_length=4\n        )\n\n        self.play(Create(tangent_line), FadeIn(px))\n        self.wait()\n\n        # Zoom in\n        zoomed_camera = ZoomedScene(self)\n        zoomed_display = zoomed_camera.zoomed_display\n        zoomed_display.move_to(px)\n        zoomed_display.scale(0.5)\n        self.play(Create(zoomed_camera.frame))\n        self.activate_zooming()\n        self.play(zoomed_camera.frame.animate.scale(0.5).move_to(px))\n        self.wait()\n\n        derivative_notation = MathTex(\"f'(x) = \\\\text{slope of tangent line}\")\n        derivative_notation.to_edge(DOWN)\n        self.play(Write(derivative_notation))\n        self.wait(2)\n</manim_code>\n</ideal_output>\n</example>\n</examples>\n\n"
        },
        {
          "type": "text",
          "text": "You are an expert in creating educational mathematics videos using the Manim library. Your task is to convert a given section of LaTeX/Markdown content into a visually appealing and engaging video outline, along with corresponding Manim code for implementation.\n\nHere is the section of content to be converted into a video:\n\n<section>\n{{section}}\n</section>\n\nAdditional context or narration for the video (if provided):\n\n<transcript>\n{{transcript}}\n</transcript>\n\nYour goal is to create a video that is visually engaging, intuitive, and enhances understanding of the mathematical concepts presented. Follow these steps to complete the task:\n\n1. Create a video outline:\n   - Break down the content into logical scenes\n   - For each scene, describe its focus, transitions, and key visual elements\n   - Ensure smooth transitions between scenes for a cohesive video\n\n2. Generate Manim code for each scene:\n   - Implement the scenes as described in the outline\n   - Include animations, transitions, and visual elements that enhance understanding\n   - Ensure the code aligns with the Manim library's syntax and best practices\n\nRequirements for the video:\n1. Use smooth animations to make the content visually engaging\n2. Create intuitive explanations using diagrams, illustrations, and animations where possible\n3. Include clear and concise labels, equations, or bullet points to support key points\n4. Use visuals to emphasize relationships, comparisons, or changes over time\n5. Incorporate color-coding to highlight key parts of equations or graphs\n6. Implement smooth transitions such as fade-ins, zooms, or rotations\n\nOutput Format:\nProvide your response in the following format:\n\n<video_outline>\n[Detailed outline of the video, broken down into scenes]\n</video_outline>\n\n<manim_code>\n[Manim code for each scene, separated by comments indicating the scene number]\n</manim_code>\n\nBefore providing your final output, plan the video structure and implementation inside <video_planning> tags:\n\n1. List the main mathematical concepts present in the content.\n2. Brainstorm potential visual representations for each concept.\n3. Outline a rough structure for the video, breaking it down into numbered scenes.\n4. For each scene, list key visual elements and animations that could be used.\n\nIt's OK for this section to be quite long."
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "<video_planning>"
        }
      ]
    }
  ]
});
console.log(msg);